package com.mcbot.servercontrol;

import java.util.*;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.RegistryAccess;
import net.minecraft.core.component.DataComponentMap;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.RegistryOps;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.tags.EnchantmentTags;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.alchemy.PotionContents;
import net.minecraft.world.item.alchemy.Potions;
import net.minecraft.world.item.enchantment.EnchantmentEffectComponents;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.item.enchantment.ItemEnchantments;

/**
 * Version shim for MC 1.21.1: an item's data (data components since 1.20.5; NBT before) read into what the shared
 * code compares and prints ({@link ItemData}), so receipts and guards look the same on every version (see {@link Version}).
 */
final class VersionItems {
    private VersionItems() {}

    /** The stack carries no data beyond what its item has by default. */
    static boolean noExtraData(ItemStack stack) { return stack.getComponentsPatch().isEmpty(); }

    /** The potion in a bottle or tipped arrow, null when none (water and awkward potions are potions too). */
    static ResourceLocation potion(ItemStack stack) {
        PotionContents contents = stack.get(DataComponents.POTION_CONTENTS);
        return contents == null ? null : contents.potion().flatMap(h -> h.unwrapKey()).map(k -> k.location()).orElse(null);
    }

    /** Effects added to the stack beyond its potion's own. */
    static boolean customPotionEffects(ItemStack stack) {
        PotionContents contents = stack.get(DataComponents.POTION_CONTENTS);
        return contents != null && !contents.customEffects().isEmpty();
    }

    /** Whether the server knows a potion of this id. */
    static boolean potionExists(ResourceLocation id) { return BuiltInRegistries.POTION.getHolder(id).isPresent(); }

    /** One bottle (or splash, lingering) of this known potion. */
    static ItemStack potionStack(Item item, ResourceLocation potion) {
        return PotionContents.createItemStack(item, BuiltInRegistries.POTION.getHolder(potion).orElseThrow());
    }

    /** A water bottle. */
    static ItemStack waterBottle() { return PotionContents.createItemStack(Items.POTION, Potions.WATER); }

    /** Enchantments on the stack, in the stack's order. */
    static List<ItemData.Enchant> enchantments(ItemStack stack) { return list(stack.get(DataComponents.ENCHANTMENTS)); }

    /** Enchantments stored in an enchanted book. */
    static List<ItemData.Enchant> storedEnchantments(ItemStack stack) { return list(stack.get(DataComponents.STORED_ENCHANTMENTS)); }

    private static List<ItemData.Enchant> list(ItemEnchantments enchantments) {
        if (enchantments == null || enchantments.isEmpty()) return List.of();
        List<ItemData.Enchant> list = new ArrayList<>();
        for (var entry : enchantments.entrySet())
            list.add(new ItemData.Enchant(entry.getKey().unwrapKey().map(k -> k.location().toString()).orElse("?"), entry.getIntValue()));
        return list;
    }

    /** The levels of the stack's enchantments added up, curses (binding, vanishing) left out. */
    static int nonCurseLevels(ItemStack stack) {
        int levels = 0;
        ItemEnchantments enchantments = stack.get(DataComponents.ENCHANTMENTS);
        if (enchantments != null) for (var entry : enchantments.entrySet()) if (!entry.getKey().is(EnchantmentTags.CURSE)) levels += entry.getIntValue();
        return levels;
    }

    /** Worn, it cannot be taken off again (curse of binding). */
    static boolean binding(ItemStack stack) { return EnchantmentHelper.has(stack, EnchantmentEffectComponents.PREVENT_ARMOR_CHANGE); }

    /** Adds silk touch I to the stack (a test tool for what a block drops). */
    static void enchantSilkTouch(ItemStack stack, RegistryAccess registries) {
        stack.enchant(registries.registryOrThrow(Registries.ENCHANTMENT).getHolderOrThrow(Enchantments.SILK_TOUCH), 1);
    }

    /** The enchantment an enchanting table's clue number stands for, "?" when it stands for none. */
    static String enchantmentByNumber(RegistryAccess registries, int number) {
        var holder = registries.registryOrThrow(Registries.ENCHANTMENT).asHolderIdMap().byId(number);
        return holder == null ? "?" : holder.unwrapKey().map(k -> k.location().toString()).orElse("?");
    }

    /** Damage taken as the stack records it, 0 when it records none. */
    static int damage(ItemStack stack) { Integer damage = stack.get(DataComponents.DAMAGE); return damage == null ? 0 : damage; }

    /** Renamed (anvil or command). */
    static boolean customName(ItemStack stack) { return stack.has(DataComponents.CUSTOM_NAME); }

    /** What anvil work has added to the next repair's cost, 0 when none. */
    static int repairCost(ItemStack stack) { Integer cost = stack.get(DataComponents.REPAIR_COST); return cost == null ? 0 : cost; }

    /**
     * The data the stack carries beyond its item's defaults that is not of these kinds, each named by its id ("-" before
     * data taken away from the defaults). Empty when there is none.
     */
    static List<String> otherData(ItemStack stack, Set<ItemData.Kind> named) {
        List<String> other = new ArrayList<>();
        for (var entry : stack.getComponentsPatch().entrySet()) {
            var type = entry.getKey();
            if (named.stream().anyMatch(kind -> component(kind) == type)) continue;
            var key = BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(type);
            other.add((entry.getValue().isPresent() ? "" : "-") + (key == null ? "component" : key.toString()));
        }
        return other;
    }

    /** Looked up per call, not held in a static map: the components need a bootstrapped game. */
    private static DataComponentType<?> component(ItemData.Kind kind) {
        return switch (kind) {
            case POTION -> DataComponents.POTION_CONTENTS;
            case ENCHANTMENTS -> DataComponents.ENCHANTMENTS;
            case STORED_ENCHANTMENTS -> DataComponents.STORED_ENCHANTMENTS;
            case DAMAGE -> DataComponents.DAMAGE;
            case CUSTOM_NAME -> DataComponents.CUSTOM_NAME;
            case LORE -> DataComponents.LORE;
            case REPAIR_COST -> DataComponents.REPAIR_COST;
            case BANNER_PATTERNS -> DataComponents.BANNER_PATTERNS;
            case BASE_COLOR -> DataComponents.BASE_COLOR;
        };
    }

    /** Armour points and toughness the stack adds worn in this slot: {armour, toughness}, flat additions only. */
    static double[] armourPoints(ItemStack stack, EquipmentSlot slot) {
        double[] sums = {0, 0};
        stack.forEachModifier(slot, (attribute, modifier) -> {
            if (modifier.operation() != AttributeModifier.Operation.ADD_VALUE) return;
            if (attribute.value() == Attributes.ARMOR.value()) sums[0] += modifier.amount();
            else if (attribute.value() == Attributes.ARMOR_TOUGHNESS.value()) sums[1] += modifier.amount();
        });
        return sums;
    }

    /** What eating the stack does for this eater (NeoForge lets the stack decide), or null when it is not food. */
    static FoodSafety.Food food(ItemStack stack, LivingEntity eater) {
        FoodProperties food = stack.getFoodProperties(eater);
        if (food == null) return null;
        return new FoodSafety.Food(food.nutrition(), food.saturation(), food.eatDurationTicks(), !food.effects().isEmpty(), food.canAlwaysEat(), food.usingConvertsTo());
    }

    /** The id of data on the stack that is never saved, or null when there is none. */
    static String transientData(ItemStack stack) {
        for (var component : stack.getComponents()) if (component.type().isTransient())
            return String.valueOf(BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(component.type()));
        return null;
    }

    /**
     * All of the stack's data as NBT keyed by component id in the 1.21 shape ("minecraft:damage": 3,
     * "minecraft:enchantments": {levels: {...}}, ...), empty when it cannot be written. This is the "components" of
     * the wire protocol (docs/server_body_protocol.md): client-runtime reads these keys, so every version gives them.
     */
    static Optional<Tag> encodeData(ItemStack stack, HolderLookup.Provider registries) {
        return DataComponentMap.CODEC.encodeStart(RegistryOps.create(NbtOps.INSTANCE, registries), stack.getComponents()).result();
    }

    /** How many of this item one stack holds by default. */
    static int maxStackSize(Item item) { return item.getDefaultMaxStackSize(); }
}
