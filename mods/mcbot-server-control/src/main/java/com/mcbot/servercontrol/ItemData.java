package com.mcbot.servercontrol;

/**
 * Item data as the shared code reads it, the same on every game version: components since 1.20.5, NBT before.
 * {@link VersionItems} in the version folder reads a stack into these.
 */
final class ItemData {
    private ItemData() {}

    /** The kinds of item data the shared code names (1.21 components: potion_contents, enchantments, ...). */
    enum Kind {POTION,ENCHANTMENTS,STORED_ENCHANTMENTS,DAMAGE,CUSTOM_NAME,LORE,REPAIR_COST,BANNER_PATTERNS,BASE_COLOR}

    /** One enchantment on a stack: its id ("?" when it has none) and level. */
    record Enchant(String id,int level) {
        /** A vanilla enchantment; one without an id is not. */
        boolean vanilla(){return id.startsWith("minecraft:");}
    }
}
