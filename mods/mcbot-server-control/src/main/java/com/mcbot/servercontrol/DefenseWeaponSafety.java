package com.mcbot.servercontrol;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.*;
import java.util.*;
import static com.mcbot.servercontrol.Protocol.*;

/** Deliberately excludes enchantments and altered behavior components until a verified adapter exists. */
final class DefenseWeaponSafety {
    /** The only item data a defense weapon may carry. */
    private static final Set<ItemData.Kind> DATA=EnumSet.of(ItemData.Kind.DAMAGE,ItemData.Kind.CUSTOM_NAME,ItemData.Kind.LORE,ItemData.Kind.REPAIR_COST);
    private static final Set<String> ITEMS=Set.of("wooden_sword","stone_sword","iron_sword","golden_sword","diamond_sword","netherite_sword","wooden_axe","stone_axe","iron_axe","golden_axe","diamond_axe","netherite_axe");
    static void require(ItemStack stack,int attacks) {
        if(stack.isEmpty())return;
        Class<?> type=stack.getItem().getClass();
        var id=BuiltInRegistries.ITEM.getKey(stack.getItem());
        if(!id.getNamespace().equals("minecraft")||!ITEMS.contains(id.getPath())||(type!=SwordItem.class&&type!=AxeItem.class))throw error("UNSUPPORTED","UNVERIFIED_WEAPON_IMPLEMENTATION");
        if(!VersionItems.otherData(stack,DATA).isEmpty())throw error("UNSUPPORTED","UNVERIFIED_WEAPON_COMPONENT");
        if(stack.isDamageableItem()&&stack.getMaxDamage()-stack.getDamageValue()<=attacks)throw error("UNSUPPORTED","WEAPON_DURABILITY_RESERVE");
    }
}
