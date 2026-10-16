package com.mcbot.addon.farmersdelight;

import com.mcbot.servercontrol.api.workstation.Port;
import com.mcbot.servercontrol.api.workstation.RecipeSource;
import com.mcbot.servercontrol.api.workstation.StationLayout;
import com.mcbot.servercontrol.api.workstation.StationProgress;
import com.mcbot.servercontrol.api.workstation.StationRecipe;
import com.mcbot.servercontrol.api.workstation.Template;
import com.mcbot.servercontrol.api.workstation.WorkstationAdapter;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.items.IItemHandler;
import net.neoforged.neoforge.items.SlotItemHandler;

/**
 * The Farmer's Delight cooking pot as a multi-input processor for produce-item: six ingredient slots, the meal shown
 * while it waits for its container, the container slot (a bowl) and the result slot, as CookingPotMenu lays them out
 * in 1.2.9. The pot cooks by itself while heated; MCBOT puts the inputs and containers in through the menu, like a
 * player, and takes the meals out. Recipes are the server's farmersdelight:cooking recipes, read live.
 */
final class CookingPotStation implements WorkstationAdapter {
    static final CookingPotStation INSTANCE = new CookingPotStation();
    private CookingPotStation() {}
    static final String ID = "farmersdelight:cooking_pot", BLOCK_CLASS = "vectorwing.farmersdelight.common.block.CookingPotBlock",
        ENTITY_CLASS = "vectorwing.farmersdelight.common.block.entity.CookingPotBlockEntity",
        MENU_CLASS = "vectorwing.farmersdelight.common.block.entity.container.CookingPotMenu",
        RECIPE_CLASS = "vectorwing.farmersdelight.common.crafting.CookingPotRecipe";
    private static final ResourceLocation COOKING = ResourceLocation.fromNamespaceAndPath(FdAccess.MOD, "cooking");
    /** Menu slots: 0-5 ingredients, 6 the meal shown, 7 container, 8 result, then the player's 27 + 9. */
    static final int INPUTS = 6, MEAL = 6, CONTAINER = 7, OUTPUT = 8, MENU_SLOTS = 45;
    private static final String SLOTS = "vectorwing.farmersdelight.common.block.entity.container.";
    private static final List<String> SLOT_CLASSES = List.of(SlotItemHandler.class.getName(), SlotItemHandler.class.getName(), SlotItemHandler.class.getName(),
        SlotItemHandler.class.getName(), SlotItemHandler.class.getName(), SlotItemHandler.class.getName(),
        SLOTS + "CookingPotMealSlot", SLOTS + "CookingPotMenu$1", SLOTS + "CookingPotResultSlot");

    public String id() { return ID; }
    public boolean installed() { return FdAccess.installed(); }
    public Template template() { return Template.PROCESSOR; }
    public boolean block(BlockState state) { return FdAccess.is(state, ID, BLOCK_CLASS); }

    private static BlockEntity pot(AbstractContainerMenu menu) {
        try { return (BlockEntity) menu.getClass().getField("blockEntity").get(menu); } catch (ReflectiveOperationException | ClassCastException missing) { throw FdAccess.changed("CookingPotMenu.blockEntity", missing); }
    }

    public boolean menu(AbstractContainerMenu menu) {
        if (!installed() || !MENU_CLASS.equals(menu.getClass().getName()) || menu.slots.size() != MENU_SLOTS) return false;
        if (!ID.equals(String.valueOf(BuiltInRegistries.MENU.getKey(menu.getType())))) return false;
        BlockEntity pot = pot(menu);
        if (pot == null || !ENTITY_CLASS.equals(pot.getClass().getName()) || !block(pot.getBlockState())) return false;
        IItemHandler inventory = (IItemHandler) FdAccess.call(FdAccess.method(pot.getClass(), "getInventory"), pot);
        List<String> classes = new ArrayList<>();
        List<Object> handlers = new ArrayList<>();
        List<Integer> indices = new ArrayList<>();
        for (int i = 0; i < OUTPUT + 1; i++) {
            Slot slot = menu.getSlot(i);
            classes.add(slot.getClass().getName());
            handlers.add(slot instanceof SlotItemHandler handler ? handler.getItemHandler() : null);
            indices.add(slot.getContainerSlot());
        }
        Object playerInventory = menu.getSlot(OUTPUT + 1).container;
        if (!(playerInventory instanceof Inventory)) return false;
        for (int i = OUTPUT + 1; i < MENU_SLOTS; i++) {
            Slot slot = menu.getSlot(i);
            if (slot.getClass() != Slot.class || slot.container != playerInventory || slot.getContainerSlot() != FdRules.playerSlot(i)) return false;
        }
        return FdRules.potSlots(classes, SLOT_CLASSES, handlers, inventory, indices);
    }

    public StationLayout layout(AbstractContainerMenu menu) {
        if (!menu(menu)) return null;
        Map<Port, List<Integer>> slots = new EnumMap<>(Port.class);
        slots.put(Port.INGREDIENT, List.of(0, 1, 2, 3, 4, 5));
        slots.put(Port.BUFFER, List.of(MEAL));
        slots.put(Port.CONTAINER, List.of(CONTAINER));
        slots.put(Port.RESULT, List.of(OUTPUT));
        return new StationLayout(slots, 0, 0);
    }

    /** The server's cooking recipes for the wanted item, in recipe id order; the pot takes its inputs in any order. */
    public RecipeSource recipes(BlockState state) {
        return new RecipeSource() {
            @Override public List<StationRecipe> producing(ServerPlayer player, Item wanted) { return cooking(player.serverLevel(), wanted); }
        };
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static List<StationRecipe> cooking(Level level, Item wanted) {
        RecipeType<?> type = BuiltInRegistries.RECIPE_TYPE.get(COOKING);
        if (type == null) throw FdAccess.changed("recipe type " + COOKING, null);
        List<StationRecipe> found = new ArrayList<>();
        for (RecipeHolder<?> holder : (List<RecipeHolder<?>>) (List) level.getRecipeManager().getAllRecipesFor((RecipeType) type)) {
            Object recipe = holder.value();
            if (!RECIPE_CLASS.equals(recipe.getClass().getName())) continue;
            ItemStack result = holder.value().getResultItem(level.registryAccess());
            if (result.isEmpty() || !result.is(wanted)) continue;
            List<Ingredient> inputs = holder.value().getIngredients().stream().filter(i -> !i.isEmpty()).toList();
            if (inputs.isEmpty() || inputs.size() > INPUTS) continue;
            ItemStack container = (ItemStack) FdAccess.call(FdAccess.method(recipe.getClass(), "getOutputContainer"), recipe);
            int ticks = (int) FdAccess.call(FdAccess.method(recipe.getClass(), "getCookTime"), recipe);
            float experience = (float) FdAccess.call(FdAccess.method(recipe.getClass(), "getExperience"), recipe);
            found.add(StationRecipe.shapeless(holder.id(), result, inputs, container, ticks, experience));
        }
        found.sort((a, b) -> a.id().toString().compareTo(b.id().toString()));
        return found;
    }

    /** Without heat the pot keeps its inputs and does nothing. */
    public String notReady(AbstractContainerMenu menu) {
        return heated(pot(menu)) ? null : "The cooking pot has no heat below it (a lit stove or campfire, fire, or another block of #farmersdelight:heat_sources)";
    }

    public boolean working(AbstractContainerMenu menu) { return working(pot(menu)); }

    private static volatile Field cookTime, cookTimeTotal;
    private static int field(BlockEntity pot, boolean total) {
        try {
            Field f = total ? cookTimeTotal : cookTime;
            if (f == null) {
                f = pot.getClass().getDeclaredField(total ? "cookTimeTotal" : "cookTime");
                f.setAccessible(true);
                if (total) cookTimeTotal = f; else cookTime = f;
            }
            return f.getInt(pot);
        } catch (ReflectiveOperationException | RuntimeException missing) { throw FdAccess.changed("CookingPotBlockEntity cook time", missing); }
    }
    private static boolean heated(BlockEntity pot) { return (boolean) FdAccess.call(FdAccess.method(pot.getClass(), "isHeated"), pot); }
    /** Cooking right now: heated and part way through a meal (the pot resets its timer when it cannot cook). */
    private static boolean working(BlockEntity pot) { return heated(pot) && field(pot, false) > 0; }

    public StationProgress progress(Level level, BlockPos pos, BlockState state) {
        if (!block(state)) return null;
        BlockEntity pot = level.getChunkAt(pos).getBlockEntity(pos);
        if (pot == null || !ENTITY_CLASS.equals(pot.getClass().getName())) return null;
        IItemHandler inventory = (IItemHandler) FdAccess.call(FdAccess.method(pot.getClass(), "getInventory"), pot);
        List<ItemStack> inputs = new ArrayList<>();
        for (int i = 0; i < INPUTS; i++) inputs.add(inventory.getStackInSlot(i));
        List<ItemStack> results = List.of(inventory.getStackInSlot(OUTPUT));
        ItemStack meal = inventory.getStackInSlot(MEAL);
        // Between two meals the pot's timer is 0 for a tick, so "working" here means it will go on: heated, inputs
        // in, and room for the next meal in the slot that shows it.
        int sets = inputs.stream().filter(s -> !s.isEmpty()).mapToInt(ItemStack::getCount).min().orElse(0);
        boolean working = heated(pot) && sets > 0 && (meal.isEmpty() || meal.getCount() < meal.getMaxStackSize());
        int ticks = FdRules.potTicksLeft(sets, field(pot, false), field(pot, true), working);
        return new StationProgress(inputs, results, ItemStack.EMPTY, working, ticks, -1);
    }
}
