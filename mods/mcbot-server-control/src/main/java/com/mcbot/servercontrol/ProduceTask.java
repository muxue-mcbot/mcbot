package com.mcbot.servercontrol;

import com.google.gson.*;
import com.mcbot.servercontrol.api.workstation.*;
import java.util.*;
import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.item.*;
import net.minecraft.world.item.alchemy.*;
import static com.mcbot.servercontrol.Protocol.*;
import static com.mcbot.servercontrol.NativeWorkstation.*;

/**
 * produce-item: make an item at a station that is neither a crafting grid nor a furnace. Stonecutter: the input goes
 * in, the recipe's button is pressed, the result is shift-clicked out (the game repeats until the input is used up),
 * leftovers come back. Brewing stand: a plan of stages from bottles the body holds to the wanted potion, using the
 * server's own brewing rules; bottles go in, one reagent per stage. By default the body starts one stage and leaves
 * (8b: the runtime wakes the agent when it is done); calling again at a stand that holds these bottles goes on with the
 * next stage, and takes the bottles out once they are the wanted potion. wait:true stays beside the stand through every
 * stage instead. Blaze powder is added when the stand's fuel would run out. An add-on processor with several inputs
 * (a cooking pot): the inputs go into its ingredient slots and the recipe's containers into its container slot; once it
 * is seen working the body leaves (or with wait:true takes the results as they come); calling again with the same item
 * takes out what is done.
 */
final class ProduceTask extends StationJob {
    static final int MAX_STAGES=4;
    private Item wanted;
    private int count;
    // stonecutter
    private StationRecipe recipe;
    private int inputs;
    // brewing
    private Holder<Potion> potion;
    private ItemStack startBottle;
    private List<Stage> stages;
    private int stage=-1,fuelAdded;
    private List<Integer> bottleSlots=List.of();
    private long stageStarted;
    private boolean wait,continuing,brewingNow;
    /** The first stage is already brewing in the stand (continuing with wait): its reagent is not put in again. */
    private boolean firstInStand;
    record Stage(Item ingredient,ItemStack result) {}

    ProduceTask(ControlSession.Operation operation,BodyPlayer player,ControlSession session){super(operation,player,session);}
    String noStationCode(){return potion!=null?"NO_BREWING_STAND":cookers!=null?"NO_STATION":"NO_STONECUTTER";}
    private static int integer(JsonObject args,String key,int fallback,int min,int max) {
        double value=bounded(args,key,fallback,min,max);
        if(value!=Math.rint(value))throw error("INVALID_ARGUMENT",key+" must be an integer");
        return (int)value;
    }
    static boolean potionItem(Item item){return item==Items.POTION||item==Items.SPLASH_POTION||item==Items.LINGERING_POTION;}
    static Holder<Potion> potion(String id) {
        ResourceLocation key=ResourceLocation.tryParse(id.contains(":")?id:"minecraft:"+id);
        var found=key==null?Optional.<Holder.Reference<Potion>>empty():BuiltInRegistries.POTION.getHolder(key);
        if(found.isEmpty())throw error("INVALID_ARGUMENT","Unknown potion "+id);
        return found.get();
    }
    static boolean isPotion(ItemStack stack,Item item,Holder<Potion> potion) {
        if(!stack.is(item))return false;
        PotionContents contents=stack.get(DataComponents.POTION_CONTENTS);
        return contents!=null&&contents.is(potion)&&contents.customEffects().isEmpty();
    }

    @Override void begin() {
        JsonObject args=operation.args;wanted=item(string(args,"item"));
        wait=args.has("wait")&&bool(args,"wait");
        deadline=now()+(long)bounded(args,"timeoutMs",potionItem(wanted)?(wait?240_000:60_000):30_000,1000,600_000);
        if(potionItem(wanted)||args.has("potion")) {
            if(!potionItem(wanted))throw error("INVALID_ARGUMENT","potion only goes with minecraft:potion, splash_potion or lingering_potion");
            if(!args.has("potion"))throw error("INVALID_ARGUMENT","Say which potion, e.g. potion: \"minecraft:swiftness\"");
            potion=potion(string(args,"potion"));count=integer(args,"count",1,1,3);beginBrewing();return;
        }
        count=integer(args,"count",1,1,64);
        List<StationRecipe> recipes=VanillaWorkstations.STONECUTTING.producing(player,wanted);
        if(recipes.isEmpty()&&beginCooking())return;
        if(recipes.isEmpty())throw error("NO_RECIPE",id(wanted)+" is not made at a stonecutter, a brewing stand or an add-on's cooking station"+hint(wanted));
        Inventory inventory=player.getInventory();
        for(StationRecipe r:recipes){int need=(count+r.result().getCount()-1)/r.result().getCount();if(need<=64&&NativeWorkstation.allocate(r,inventory,need)!=null){recipe=r;inputs=need;break;}}
        if(recipe==null) {
            StationRecipe best=recipes.getFirst();int need=(count+best.result().getCount()-1)/best.result().getCount();
            failureDetail=obj("recipe",best.id().toString(),"missing",missing(best,inventory,need));
            throw error("MISSING_MATERIALS","Not enough input for "+count+" "+id(wanted)+" at a stonecutter");
        }
        findStations(List.of(VanillaWorkstations.STONECUTTER),(a,s)->true);
    }
    /** Where else the item is made, so the agent picks the right tool. */
    private String hint(Item item) {
        if(!VanillaWorkstations.CRAFTING.producing(player,item).isEmpty())return "; it is crafted: use craft-item";
        for(var type:List.of(net.minecraft.world.item.crafting.RecipeType.SMELTING,net.minecraft.world.item.crafting.RecipeType.SMOKING,net.minecraft.world.item.crafting.RecipeType.BLASTING))
            for(var holder:player.getServer().getRecipeManager().getAllRecipesFor(type))if(holder.value().getResultItem(player.registryAccess()).is(item))return "; it is smelted: use smelt-item";
        return "";
    }

    @Override void opened(AbstractContainerMenu menu,StationLayout layout) {
        if(potion!=null){openedBrewing(menu,layout);return;}
        if(cookers!=null){openedCooking(menu,layout);return;}
        int in=layout.slot(Port.INGREDIENT),out=layout.slot(Port.RESULT);
        if(!menu.getSlot(in).getItem().isEmpty()||!menu.getSlot(out).getItem().isEmpty()){closeMenu(player);skip("busy");return;}
        Inventory inventory=player.getInventory();
        var plan=NativeWorkstation.allocate(recipe,inventory,inputs);
        if(plan==null){fail("MISSING_MATERIALS","The input is no longer in the inventory",obj());return;}
        for(var take:plan.getFirst().entrySet())transfer(player,menu,take.getKey(),in,take.getValue());
        int button=-1;
        for(StationOption option:safely(()->station.adapter().options(player,menu),List.<StationOption>of()))if(option.id().equals(recipe.id().toString()))button=option.button();
        if(button<0){takeBack(menu,List.of(in));fail("RECIPE_REFUSED","The stonecutter did not offer "+recipe.id(),obj("recipe",recipe.id().toString()));return;}
        button(player,menu,button);
        ItemStack shown=menu.getSlot(out).getItem();
        if(shown.isEmpty()||!shown.is(wanted)){takeBack(menu,List.of(in));fail("RECIPE_REFUSED","The stonecutter did not show "+id(wanted),obj("recipe",recipe.id().toString()));return;}
        int had=total(inventory,wanted);
        quickMove(player,menu,out);
        int made=total(inventory,wanted)-had;
        boolean back=takeBack(menu,List.of(in)); // never shift-click the result again: that would cut more
        JsonObject result=obj("item",id(wanted),"requestedCount",count,"made",made,"recipe",recipe.id().toString(),"station",pos(station.pos()));
        if(!back)result.addProperty("leftInStation",true);
        if(made<=0){fail("INVENTORY_FULL","No room in the inventory for the result",result);return;}
        succeed(made<count?"Cut "+made+" of "+count+" "+id(wanted)+" (inventory full)":"Cut "+made+" "+id(wanted),result);
    }

    // ---------- brewing ----------
    private ItemStack target(){return PotionContents.createItemStack(wanted,potion);}
    /** Distinct bottle kinds in the main inventory: a sample stack and how many slots hold it. */
    private Map<ItemStack,Integer> bottlesHeld() {
        Map<ItemStack,Integer> kinds=new LinkedHashMap<>();Inventory inventory=player.getInventory();
        outer:
        for(int i=0;i<36;i++){
            ItemStack s=inventory.getItem(i);if(!potionItem(s.getItem())||s.getCount()!=1)continue;
            for(var e:kinds.entrySet())if(ItemStack.isSameItemSameComponents(e.getKey(),s)){e.setValue(e.getValue()+1);continue outer;}
            kinds.put(s.copy(),1);
        }
        return kinds;
    }
    /** Shortest chain of stages from `start` to the wanted potion using these reagents (null: any brewing reagent). */
    private List<Stage> plan(ItemStack start,Map<Item,Integer> reagents) {
        RecipeSource brewing=VanillaWorkstations.BREWING;
        Collection<Item> candidates=reagents!=null?reagents.keySet():allReagents();
        record Node(ItemStack stack,List<Stage> path) {}
        Deque<Node> queue=new ArrayDeque<>();queue.add(new Node(start,List.of()));Set<String> seen=new HashSet<>();seen.add(ItemDescriptions.key(start));
        while(!queue.isEmpty()) {
            Node node=queue.poll();
            if(isPotion(node.stack(),wanted,potion))return node.path();
            if(node.path().size()>=MAX_STAGES)continue;
            for(Item reagent:candidates) {
                if(reagents!=null&&node.path().stream().filter(s->s.ingredient()==reagent).count()>=reagents.get(reagent))continue;
                var next=brewing.transform(player,node.stack(),new ItemStack(reagent));
                if(next.isEmpty()||!seen.add(ItemDescriptions.key(next.get())))continue;
                List<Stage> path=new ArrayList<>(node.path());path.add(new Stage(reagent,next.get()));
                queue.add(new Node(next.get(),path));
            }
        }
        return null;
    }
    private List<Item> allReagents() {
        List<Item> items=new ArrayList<>();
        for(Item item:BuiltInRegistries.ITEM)if(item!=Items.AIR&&VanillaWorkstations.BREWING.isIngredient(player,new ItemStack(item)))items.add(item);
        return items;
    }
    private Map<Item,Integer> reagentsHeld() {
        Map<Item,Integer> held=new LinkedHashMap<>();Inventory inventory=player.getInventory();
        for(int i=0;i<36;i++){ItemStack s=inventory.getItem(i);if(plain(s)&&VanillaWorkstations.BREWING.isIngredient(player,s))held.merge(s.getItem(),s.getCount(),Integer::sum);}
        return held;
    }
    private int plainCount(Item item){int n=0;Inventory inv=player.getInventory();for(int i=0;i<36;i++){ItemStack s=inv.getItem(i);if(plain(s)&&s.is(item))n+=s.getCount();}return n;}
    private JsonArray describe(List<Stage> path){JsonArray a=new JsonArray();for(Stage s:path)a.add(obj("ingredient",id(s.ingredient()),"result",ItemDescriptions.key(s.result())));return a;}

    private void beginBrewing() {
        Map<ItemStack,Integer> held=bottlesHeld();Map<Item,Integer> reagents=reagentsHeld();
        Protocol.Error noStand=null;
        try { findStations(List.of(VanillaWorkstations.BREWING_STAND),(a,s)->true); } catch(Protocol.Error none) { noStand=none; }
        // A stand already holding bottles on the way to this potion (left there earlier): go on there.
        for(Station at:List.copyOf(stations)) {
            if(!(player.serverLevel().getBlockEntity(at.pos()) instanceof net.minecraft.world.level.block.entity.BrewingStandBlockEntity stand))continue;
            ItemStack bottle=null;int n=0;boolean mixed=false;
            for(int i=0;i<3;i++){ItemStack s=stand.getItem(i);if(s.isEmpty())continue;if(bottle==null)bottle=s.copy();else if(!ItemStack.isSameItemSameComponents(bottle,s))mixed=true;n++;}
            if(bottle==null||mixed||!potionItem(bottle.getItem()))continue;
            ItemStack reagentIn=stand.getItem(3),from=bottle;
            // Mid-brew: plan from what the bottles are becoming.
            if(!reagentIn.isEmpty()){var next=VanillaWorkstations.BREWING.transform(player,bottle,reagentIn);if(next.isEmpty())continue;from=next.get();}
            List<Stage> path=isPotion(from,wanted,potion)?List.of():plan(from,reagents);
            if(path==null) {
                List<Stage> full=plan(from,null);
                if(full==null)continue; // not on the way to this potion: someone else's brew
                Map<Item,Integer> need=new LinkedHashMap<>();for(Stage s:full)need.merge(s.ingredient(),1,Integer::sum);
                JsonArray missing=new JsonArray();
                for(var e:need.entrySet()){int have=reagents.getOrDefault(e.getKey(),0);if(have<e.getValue())missing.add(obj("options",List.of(id(e.getKey())),"need",e.getValue(),"have",have));}
                failureDetail=obj("station",pos(at.pos()),"inStand",obj("bottle",ItemDescriptions.key(from),"count",n),"stages",describe(full),"missing",missing);
                throw error("MISSING_MATERIALS","The brewing stand at "+at.pos().toShortString()+" holds "+n+" bottles on the way; to go on: "+missing);
            }
            stations.remove(at);stations.addFirst(at);
            startBottle=bottle;count=n;continuing=true;brewingNow=!reagentIn.isEmpty();
            stages=new ArrayList<>(path);
            if(brewingNow){stages.addFirst(new Stage(reagentIn.getItem(),from));firstInStand=true;}
            return;
        }
        List<Stage> best=null;ItemStack bestStart=null;
        for(var e:held.entrySet()) {
            if(e.getValue()<count||isPotion(e.getKey(),wanted,potion))continue;
            List<Stage> path=plan(e.getKey(),reagents);
            if(path!=null&&!path.isEmpty()&&(best==null||path.size()<best.size())){best=path;bestStart=e.getKey();}
        }
        if(best==null) {
            // What would be needed: the shortest chain from a bottle held (or a water bottle) with any reagent.
            ItemStack water=PotionContents.createItemStack(Items.POTION,Potions.WATER);
            List<Stage> full=null;ItemStack from=null;
            List<ItemStack> starts=new ArrayList<>(held.keySet());starts.add(water);
            for(ItemStack start:starts){List<Stage> path=plan(start,null);if(path!=null&&!path.isEmpty()&&(full==null||path.size()<full.size())){full=path;from=start;}}
            if(full==null)throw error("NO_RECIPE","No brewing chain of up to "+MAX_STAGES+" stages makes "+ItemDescriptions.key(target()));
            JsonArray missing=new JsonArray();int bottlesHave=0;
            for(var e:held.entrySet())if(ItemStack.isSameItemSameComponents(e.getKey(),from))bottlesHave=e.getValue();
            if(bottlesHave<count)missing.add(obj("options",List.of(ItemDescriptions.key(from)),"need",count,"have",bottlesHave));
            Map<Item,Integer> need=new LinkedHashMap<>();for(Stage s:full)need.merge(s.ingredient(),1,Integer::sum);
            for(var e:need.entrySet()){int have=reagents.getOrDefault(e.getKey(),0);if(have<e.getValue())missing.add(obj("options",List.of(id(e.getKey())),"need",e.getValue(),"have",have));}
            failureDetail=obj("stages",describe(full),"missing",missing,"fuel","blaze powder, unless the brewing stand still has fuel");
            throw error("MISSING_MATERIALS","Cannot brew "+ItemDescriptions.key(target())+" from what the inventory holds: "+missing);
        }
        if(noStand!=null)throw noStand;
        stages=best;startBottle=bestStart;
    }
    private void openedBrewing(AbstractContainerMenu menu,StationLayout layout) {
        List<Integer> subjects=layout.slots(Port.SUBJECT);int reagent=layout.slot(Port.INGREDIENT),fuelSlot=layout.slot(Port.FUEL);
        if(subjects.size()<count||reagent<0){closeMenu(player);skip("menu not recognised");return;}
        WorkstationAdapter adapter=station.adapter();
        if(continuing) {
            // The bottles left here earlier, unchanged; nothing is put in or taken out before checking.
            List<Integer> held=new ArrayList<>();
            for(int slot:subjects){ItemStack s=menu.getSlot(slot).getItem();if(s.isEmpty())continue;if(!ItemStack.isSameItemSameComponents(s,startBottle)){closeMenu(player);skip("the bottles changed");return;}held.add(slot);}
            if(held.isEmpty()){closeMenu(player);skip("the bottles are gone");return;}
            if(brewingNow!=!menu.getSlot(reagent).getItem().isEmpty()){closeMenu(player);skip("the brew changed");return;}
            bottleSlots=held;
            if(brewingNow&&!wait) {
                int ticks=safely(()->{var p=adapter.progress(player.serverLevel(),station.pos(),state(station.pos()));return p==null?-1:p.ticksLeft();},-1);
                JsonObject result=leftResult(0);if(ticks>=0)result.addProperty("readyInSeconds",ticks/20.0);
                fail("STILL_BREWING","Stage "+describeStage(0)+" is still brewing"+(ticks>=0?", about "+Math.round(ticks/20.0)+" s left":"")+"; come back when it is done",result);return;
            }
        } else {
            for(int slot:subjects)if(!menu.getSlot(slot).getItem().isEmpty()){closeMenu(player);skip("busy with someone else's bottles");return;}
            if(!menu.getSlot(reagent).getItem().isEmpty()){closeMenu(player);skip("busy with "+id(menu.getSlot(reagent).getItem()));return;}
        }
        // Fuel: brews left in the stand, plus 20 per blaze powder waiting in its fuel slot.
        int toBrew=stages.size()-(firstInStand?1:0);
        int fuel=safely(()->adapter.fuelLeft(menu),0);ItemStack inFuel=fuelSlot<0?ItemStack.EMPTY:menu.getSlot(fuelSlot).getItem();
        int covered=fuel+(inFuel.isEmpty()?0:inFuel.getCount()*safely(()->adapter.burnTicks(state(station.pos()),inFuel),0));
        // Leaving after one stage needs fuel for that stage only; the next call tops up again.
        if(covered<(wait?toBrew:Math.min(1,toBrew))) {
            Inventory inventory=player.getInventory();
            if(fuelSlot>=0&&(inFuel.isEmpty()||inFuel.is(Items.BLAZE_POWDER)))
                for(int i=0;i<36&&fuelAdded==0;i++){ItemStack s=inventory.getItem(i);if(plain(s)&&s.is(Items.BLAZE_POWDER))fuelAdded+=transfer(player,menu,i,fuelSlot,1);}
            if(fuelAdded==0){
                if(continuing){fail("NO_FUEL","The brewing stand is out of fuel and the inventory has no blaze powder; the bottles stay in the stand",leftResult(0));return;}
                fail("NO_FUEL","The brewing stand has fuel for "+fuel+" brews and the inventory has no blaze powder",obj("fuelLeft",fuel,"stagesNeeded",toBrew));return;
            }
        }
        if(!continuing) {
            // Bottles: `count` copies of the planned start bottle.
            Inventory inventory=player.getInventory();int put=0;
            for(int i=0;i<36&&put<count;i++){ItemStack s=inventory.getItem(i);if(ItemStack.isSameItemSameComponents(s,startBottle)&&s.getCount()==1)put+=transfer(player,menu,i,subjects.get(put),1);}
            bottleSlots=subjects.subList(0,put);
            if(put<count){takeBack(menu,bottleSlots);fail("MISSING_MATERIALS","Only "+put+" matching bottles could be put in",obj());return;}
        }
        open=menu;stage=-1;nextStage();
    }
    private void nextStage() {
        stage++;
        if(stage>=stages.size()){collect("Brewed");return;}
        stageStarted=now();
        if(stage==0&&firstInStand)return; // already brewing: just wait for it
        int reagent=layout.slot(Port.INGREDIENT);Item ingredient=stages.get(stage).ingredient();Inventory inventory=player.getInventory();int put=0;
        for(int i=0;i<36&&put==0;i++){ItemStack s=inventory.getItem(i);if(plain(s)&&s.is(ingredient))put=transfer(player,open,i,reagent,1);}
        if(put==0){collect("Stopped: no "+id(ingredient)+" left for stage "+(stage+1));return;}
    }
    @Override void waitTick() {
        if(cookers!=null){cookTick();return;}
        ItemStack expected=stages.get(stage).result();
        boolean done=true;for(int slot:bottleSlots)done&=ItemStack.isSameItemSameComponents(open.getSlot(slot).getItem(),expected);
        boolean brewing=safely(()->station.adapter().working(open),false);
        // Not waiting: once this stage is brewing, leave the bottles and go; the runtime says when it is done.
        if(!wait&&brewing){leave();return;}
        if(done&&!brewing){nextStage();return;}
        long waited=now()-stageStarted;
        // Not started within 3 s (no fuel, a rule refused it) or far past the 20 s brew: take everything back.
        if(!brewing&&waited>3_000||waited>40_000){collect("Stage "+(stage+1)+" did not brew");}
    }
    private String describeStage(int index){return (index+1)+" of "+stages.size()+" ("+id(stages.get(index).ingredient())+")";}
    private String potionId(){return potion.unwrapKey().map(k->k.location().toString()).orElse("?");}
    /** Receipt when bottles stay in the stand: where, which stage, and how to go on. */
    private JsonObject leftResult(int index) {
        JsonObject result=obj("item",id(wanted),"potion",potionId(),"station",pos(station.pos()),"stage",index+1,"of",stages.size(),"stages",describe(stages),
            "bottles",bottleSlots.size(),"inStand",ItemDescriptions.key(startBottle),"fuelAdded",fuelAdded);
        if(index+1<stages.size())result.addProperty("nextIngredient",id(stages.get(index+1).ingredient()));
        return result;
    }
    private void leave() {
        int ticks=safely(()->{var p=station.adapter().progress(player.serverLevel(),station.pos(),state(station.pos()));return p==null?-1:p.ticksLeft();},-1);
        JsonObject result=leftResult(stage);result.addProperty("brewing",true);result.addProperty("readyInSeconds",(ticks>0?ticks:400)/20.0);
        String next=stage+1<stages.size()?"then add "+id(stages.get(stage+1).ingredient()):"then take the bottles out";
        succeed("Stage "+describeStage(stage)+" is brewing, about "+Math.round((ticks>0?ticks:400)/20.0)+" s; left the bottles in the stand. Come back and call produce-item again with the same item and potion to "+next,result);
    }
    private void collect(String why) {
        AbstractContainerMenu menu=open;List<Integer> subjects=bottleSlots;
        int reagent=layout.slot(Port.INGREDIENT);
        boolean leftReagent=!menu.getSlot(reagent).getItem().isEmpty();
        if(leftReagent)quickMove(player,menu,reagent);
        int had=0;Inventory inventory=player.getInventory();for(int i=0;i<inventory.getContainerSize();i++)if(isPotion(inventory.getItem(i),wanted,potion))had++;
        boolean back=takeBack(menu,subjects);
        int made=-had;for(int i=0;i<inventory.getContainerSize();i++)if(isPotion(inventory.getItem(i),wanted,potion))made++;
        JsonObject result=obj("item",ItemDescriptions.key(target()),"requestedCount",count,"made",made,"stages",describe(stages),"stagesDone",Math.min(stage,stages.size()),"station",pos(station.pos()),"fuelAdded",fuelAdded);
        if(!back)result.addProperty("leftInStation",true);
        if(made>=count){succeed("Brewed "+made+" "+ItemDescriptions.key(target()),result);return;}
        fail(made>0?"PARTIAL":"BREW_FAILED",why,result);
    }

    // ---------- cooking: add-on processors with several inputs (a cooking pot) ----------
    private List<WorkstationAdapter> cookers;
    private StationRecipe cookRecipe;
    private int sets,cookCollected,collectedBefore;
    private boolean collectOnly,cookStarted;
    private long loadedAt,waitUntil;
    private JsonObject cookResult;

    /**
     * Open a cooking station with an empty hand: a cooking pot serves its waiting meal into a held bowl instead of
     * opening. Without an empty hotbar slot, any slot that holds none of the recipes' containers.
     */
    @Override void beforeOpen() {
        if(cookers==null)return;
        Inventory inventory=player.getInventory();
        Set<Item> containers=new HashSet<>();
        for(WorkstationAdapter a:cookers)for(StationRecipe r:cookRecipesAt(a,null))if(!r.container().isEmpty())containers.add(r.container().getItem());
        int pick=-1;
        for(int i=0;i<9&&pick<0;i++)if(inventory.getItem(i).isEmpty())pick=i;
        for(int i=0;i<9&&pick<0;i++)if(!containers.contains(inventory.getItem(i).getItem()))pick=i;
        if(pick>=0&&pick!=inventory.selected)player.connection.handleSetCarriedItem(new net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket(pick));
    }

    private List<StationRecipe> cookRecipesAt(WorkstationAdapter adapter,net.minecraft.world.level.block.state.BlockState state) {
        return safely(()->adapter.recipes(state).producing(player,wanted),List.<StationRecipe>of());
    }
    private int crafts(StationRecipe r){return (count+r.result().getCount()-1)/r.result().getCount();}
    private int plainHeld(ItemStack kind){int n=0;Inventory inv=player.getInventory();for(int i=0;i<36;i++){ItemStack s=inv.getItem(i);if(plain(s)&&ItemStack.isSameItem(s,kind))n+=s.getCount();}return n;}
    /** Whether the inventory holds the inputs and containers for this recipe, as many times as count needs. */
    private boolean cookFeasible(StationRecipe r) {
        int n=crafts(r);
        return n<=64&&NativeWorkstation.allocate(r,player.getInventory(),n)!=null&&(r.container().isEmpty()||plainHeld(r.container())>=n);
    }
    private JsonArray cookMissing(StationRecipe r) {
        int n=crafts(r);JsonArray missing=missing(r,player.getInventory(),n);
        if(!r.container().isEmpty()&&plainHeld(r.container())<n)missing.add(obj("options",List.of(id(r.container().getItem())),"need",n,"have",plainHeld(r.container()),"container",true));
        return missing;
    }
    /**
     * The wanted item comes from an add-on processor with several inputs (a cooking pot): the inputs and containers
     * must be in the inventory before walking; without them, a station nearby that holds the item or is still making it
     * is visited to collect. False when no installed add-on processor makes the item.
     */
    private boolean beginCooking() {
        List<WorkstationAdapter> able=new ArrayList<>();
        Set<String> skip=ModAdapters.skippedNamespaces(operation.args);
        for(WorkstationAdapter adapter:ModAdapters.addonWorkstations(Template.PROCESSOR))if(!ModAdapters.skipped(adapter,skip)&&!cookRecipesAt(adapter,null).isEmpty())able.add(adapter);
        if(able.isEmpty())return false;
        cookers=able;
        deadline=now()+(long)bounded(operation.args,"timeoutMs",wait?600_000:60_000,1000,600_000);
        findStations(able,(a,s)->!cookRecipesAt(a,s).isEmpty());
        List<StationRecipe> recipes=new ArrayList<>();for(WorkstationAdapter a:able)recipes.addAll(cookRecipesAt(a,null));
        if(recipes.stream().anyMatch(this::cookFeasible))return true;
        // Nothing to cook with: go and take what a station nearby has made (or is making) of this item.
        for(Station at:List.copyOf(stations)) {
            StationProgress progress=safely(()->at.adapter().progress(player.serverLevel(),at.pos(),state(at.pos())),null);
            if(progress!=null&&(progress.results().stream().anyMatch(s->s.is(wanted))||progress.working()&&making(progress.inputs(),cookRecipesAt(at.adapter(),state(at.pos()))))){stations.remove(at);stations.addFirst(at);collectOnly=true;return true;}
        }
        StationRecipe best=recipes.getFirst();
        for(StationRecipe r:recipes)if(cookMissing(r).size()<cookMissing(best).size())best=r;
        stations.clear();
        failureDetail=obj("recipe",best.id().toString(),"missing",cookMissing(best));
        throw error("MISSING_MATERIALS","Not enough to make "+count+" "+id(wanted)+": "+cookMissing(best));
    }
    private int takeAll(AbstractContainerMenu menu,int slot) {
        ItemStack out=menu.getSlot(slot).getItem();if(out.isEmpty())return 0;
        Item kind=out.getItem();int had=total(player.getInventory(),kind);
        quickMove(player,menu,slot);
        return total(player.getInventory(),kind)-had;
    }
    private static boolean anyFilled(AbstractContainerMenu menu,List<Integer> slots){for(int s:slots)if(!menu.getSlot(s).getItem().isEmpty())return true;return false;}
    private static List<ItemStack> filled(AbstractContainerMenu menu,List<Integer> slots){List<ItemStack> out=new ArrayList<>();for(int s:slots){ItemStack i=menu.getSlot(s).getItem();if(!i.isEmpty())out.add(i);}return out;}
    /** Whether the inputs in a station (one stack per slot) are one set of one of these recipes: it is making this item. */
    private static boolean making(List<ItemStack> inputs,List<StationRecipe> recipes){for(StationRecipe r:recipes)if(MaterialAllocator.oneSet(NativeWorkstation.cells(r),inputs))return true;return false;}
    private int secondsLeft() {
        int ticks=safely(()->{var p=station.adapter().progress(player.serverLevel(),station.pos(),state(station.pos()));return p==null?-1:p.ticksLeft();},-1);
        return ticks<0?-1:Math.round(ticks/20f);
    }
    private void openedCooking(AbstractContainerMenu menu,StationLayout layout) {
        List<Integer> ins=layout.slots(Port.INGREDIENT);int out=layout.slot(Port.RESULT),box=layout.slot(Port.CONTAINER),buffer=layout.slot(Port.BUFFER);
        if(ins.isEmpty()||out<0){closeMenu(player);skip("menu not recognised");return;}
        WorkstationAdapter adapter=station.adapter();
        ItemStack done=menu.getSlot(out).getItem();
        if(!done.isEmpty()&&!done.is(wanted)){closeMenu(player);skip("busy with "+id(done));return;}
        collectedBefore=takeAll(menu,out);
        ItemStack waiting=buffer<0?ItemStack.EMPTY:menu.getSlot(buffer).getItem();
        boolean working=safely(()->adapter.working(menu),false);
        // cooking (true once left cooking) marks these receipts for the runtime, which follows the station until collected.
        JsonObject result=obj("item",id(wanted),"station",pos(station.pos()),"type",BuiltInRegistries.BLOCK.getKey(state(station.pos()).getBlock()).toString(),"cooking",false,"collected",collectedBefore);
        if(anyFilled(menu,ins)||collectOnly) {
            // Inputs from an earlier load (ours or someone else's) are still in: nothing new goes in. They are this item
            // only when they make one set of one of its recipes; another dish in the pot is someone else's.
            boolean cookingMore=making(filled(menu,ins),cookRecipesAt(adapter,state(station.pos())));
            int left=cookingMore?secondsLeft():-1;if(left>=0)result.addProperty("readyInSeconds",left);
            if(cookingMore)result.addProperty("leftInStation",true);
            if(collectedBefore>0){succeed("Collected "+collectedBefore+" "+id(wanted)+(cookingMore?"; still making the rest"+(left>=0?", about "+left+" s":""):""),result);return;}
            if(working&&cookingMore&&(waiting.isEmpty()||waiting.is(wanted))){fail("STILL_COOKING","Still making it"+(left>=0?", about "+left+" s left":"")+"; come back then",result);return;}
            if(collectOnly){fail("NOTHING_READY","Nothing of "+id(wanted)+" is ready here",result);return;}
            closeMenu(player);skip("busy with someone else's ingredients");return;
        }
        if(!waiting.isEmpty()&&!waiting.is(wanted)){closeMenu(player);skip("busy: "+id(waiting)+" waits for its container");return;}
        String why=safely(()->adapter.notReady(menu),null);
        if(why!=null){fail("STATION_NOT_READY",why,result);return;}
        StationRecipe plan=null;
        for(StationRecipe r:cookRecipesAt(adapter,state(station.pos())))if(r.cells().size()<=ins.size()&&(r.container().isEmpty()||box>=0)&&cookFeasible(r)){plan=r;break;}
        if(plan==null){fail("MISSING_MATERIALS","The inputs are no longer in the inventory",result);return;}
        ItemStack inBox=box<0?ItemStack.EMPTY:menu.getSlot(box).getItem();
        if(!plan.container().isEmpty()&&!inBox.isEmpty()&&!ItemStack.isSameItem(inBox,plan.container())){closeMenu(player);skip("its container slot holds "+id(inBox));return;}
        sets=crafts(plan);
        Inventory inventory=player.getInventory();
        var take=NativeWorkstation.allocate(plan,inventory,sets);
        for(int cell=0;cell<take.size();cell++)for(var t:take.get(cell).entrySet())transfer(player,menu,t.getKey(),ins.get(cell),t.getValue());
        int containersPut=0;
        if(!plan.container().isEmpty()) {
            int need=Math.max(0,sets-inBox.getCount());
            for(int i=0;i<36&&containersPut<need;i++){ItemStack s=inventory.getItem(i);if(plain(s)&&ItemStack.isSameItem(s,plan.container()))containersPut+=transfer(player,menu,i,box,need-containersPut);}
        }
        cookRecipe=plan;cookResult=result;
        result.addProperty("recipe",plan.id().toString());result.addProperty("sets",sets);
        if(!plan.container().isEmpty()){result.addProperty("container",id(plan.container().getItem()));result.addProperty("containersAdded",containersPut);}
        result.addProperty("cookSeconds",plan.ticks()/20.0);
        open=menu;loadedAt=now();
        waitUntil=Math.min(deadline,loadedAt+(long)sets*plan.ticks()*50L+10_000);
    }
    /** After loading: it must start within 3 s (heat, the station's own recipe check); then leave, or wait and take results. */
    private void cookTick() {
        WorkstationAdapter adapter=station.adapter();
        List<Integer> ins=layout.slots(Port.INGREDIENT);int out=layout.slot(Port.RESULT),box=layout.slot(Port.CONTAINER),buffer=layout.slot(Port.BUFFER);
        boolean working=safely(()->adapter.working(open),false);
        if(!cookStarted) {
            if(!working) {
                if(now()-loadedAt<=3_000)return;
                List<Integer> back=new ArrayList<>(ins);if(box>=0)back.add(box);
                if(!takeBack(open,back))cookResult.addProperty("leftInStation",true);
                String why=safely(()->adapter.notReady(open),null);
                fail("RECIPE_REFUSED","The station did not start making "+id(wanted)+(why!=null?": "+why:" with these inputs")+"; took them back",cookResult);return;
            }
            cookStarted=true;
            if(!wait) {
                int seconds=Math.round(sets*cookRecipe.ticks()/20f);
                cookResult.addProperty("cooking",true);cookResult.addProperty("readyInSeconds",seconds);
                succeed("Loaded "+sets+" "+(sets==1?"set":"sets")+" for "+id(wanted)+"; ready in about "+seconds+" s. Come back and call produce-item again with the same item to take them out",cookResult);return;
            }
        }
        cookCollected+=takeAll(open,out);
        // Done when enough came out, or nothing is left to cook and nothing waits to be served (a meal shown with
        // containers at hand moves to the result slot by itself).
        boolean served=buffer<0||open.getSlot(buffer).getItem().isEmpty()||box<0||open.getSlot(box).getItem().isEmpty();
        boolean finished=cookCollected>=count||!anyFilled(open,ins)&&!working&&open.getSlot(out).getItem().isEmpty()&&served;
        if(!finished&&now()<waitUntil)return;
        cookCollected+=takeAll(open,out);
        cookResult.addProperty("collected",collectedBefore+cookCollected);
        if(anyFilled(open,ins))cookResult.addProperty("leftInStation",true);
        succeed(finished?"Made and collected "+cookCollected+" "+id(wanted):"Waited "+(waitUntil>=deadline?"until the time limit":"the expected time")+"; collected "+cookCollected+" so far",cookResult);
    }
}
