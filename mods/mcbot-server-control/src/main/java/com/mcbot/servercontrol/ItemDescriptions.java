package com.mcbot.servercontrol;

import com.google.gson.*;
import java.util.*;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;
import static com.mcbot.servercontrol.Protocol.*;

/**
 * Readable item identities that keep the components that matter: a water bottle and a potion of swiftness are both
 * minecraft:potion, a sword before and after enchanting is the same id. Receipts of workstation tools count items
 * by {@link #key}, so changes in place (brewing, enchanting, repairing) show up. Nothing is hashed.
 */
final class ItemDescriptions {
    private ItemDescriptions() {}

    /** Item id, plus the meaningful components in brackets when the stack has any: {@code minecraft:potion[potion=minecraft:swiftness]}. */
    static String key(ItemStack stack) {
        String id=NativeWorkstation.id(stack);
        if(stack.isEmpty()||VersionItems.noExtraData(stack))return id;
        List<String> parts=new ArrayList<>();
        var potion=VersionItems.potion(stack);
        if(potion!=null)parts.add("potion="+potion);
        enchantments(VersionItems.enchantments(stack),"enchantments",parts);
        enchantments(VersionItems.storedEnchantments(stack),"stored",parts);
        int damage=VersionItems.damage(stack);if(damage>0)parts.add("damage="+damage);
        if(VersionItems.customName(stack))parts.add("name="+stack.getHoverName().getString());
        int repair=VersionItems.repairCost(stack);if(repair>0)parts.add("repairCost="+repair);
        // Anything else is named by its data id, so two different stacks never look identical.
        parts.addAll(VersionItems.otherData(stack,DESCRIBED));
        return parts.isEmpty()?id:id+"["+String.join(",",parts)+"]";
    }
    private static final Set<ItemData.Kind> DESCRIBED=EnumSet.of(ItemData.Kind.POTION,ItemData.Kind.ENCHANTMENTS,ItemData.Kind.STORED_ENCHANTMENTS,ItemData.Kind.DAMAGE,ItemData.Kind.CUSTOM_NAME,ItemData.Kind.REPAIR_COST);
    private static void enchantments(List<ItemData.Enchant> enchantments,String label,List<String> parts) {
        List<String> list=enchantmentList(enchantments);
        if(!list.isEmpty())parts.add(label+"="+String.join("+",list));
    }
    /** "id level" for each enchantment, sorted. */
    private static List<String> enchantmentList(List<ItemData.Enchant> enchantments) {
        if(enchantments.isEmpty())return List.of();
        List<String> list=new ArrayList<>();
        for(var enchantment:enchantments)list.add(enchantment.id()+" "+enchantment.level());
        Collections.sort(list);return list;
    }
    /** What a living entity holds and wears ({@link EquipmentView}), or null when every slot is empty. */
    static JsonObject equipment(LivingEntity entity) {
        Map<String,EquipmentView.Item> slots=new HashMap<>();
        for(EquipmentSlot slot:EquipmentSlot.values()) {
            ItemStack stack=entity.getItemBySlot(slot);
            if(stack.isEmpty())continue;
            boolean worn=stack.isDamageableItem();
            slots.put(slot.getName(),new EquipmentView.Item(NativeWorkstation.id(stack),stack.getCount(),enchantmentList(VersionItems.enchantments(stack)),
                VersionItems.customName(stack)?stack.getHoverName().getString():null,worn?stack.getDamageValue():0,worn?stack.getMaxDamage():0));
        }
        return EquipmentView.equipment(slots);
    }
    /** An observation entry for {@link EquipmentView#attach}: nothing for an entity without gear, a null equipment when reading failed. */
    static void collectEquipment(LivingEntity entity,JsonObject target,double distance,List<EquipmentView.Entry> entries) {
        JsonObject gear;
        try{gear=equipment(entity);}catch(RuntimeException failure){entries.add(new EquipmentView.Entry(target,distance,null));return;}
        if(gear!=null)entries.add(new EquipmentView.Entry(target,distance,gear));
    }
    /** A stack for a receipt: key, count and, for gear, durability left. */
    static JsonObject describe(ItemStack stack) {
        JsonObject result=obj("item",key(stack),"count",stack.getCount());
        if(stack.isDamageableItem())result.addProperty("durability",stack.getMaxDamage()-stack.getDamageValue()+"/"+stack.getMaxDamage());
        return result;
    }
    /** All of the body's stacks counted by {@link #key}. */
    static Map<String,Integer> counts(Inventory inventory) {
        Map<String,Integer> result=new TreeMap<>();
        for(int i=0;i<inventory.getContainerSize();i++){ItemStack s=inventory.getItem(i);if(!s.isEmpty())result.merge(key(s),s.getCount(),Integer::sum);}
        return result;
    }
}
