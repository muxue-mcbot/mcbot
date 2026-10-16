package com.mcbot.servercontrol.api;

import net.minecraft.world.level.block.state.BlockState;

/**
 * How {@code tend-crops} treats a mod's crop that the generic rules would get wrong. The generic rules break a crop
 * (a {@code CropBlock}, or a block in {@code #minecraft:crops} with an {@code age}) once it is fully grown and plant
 * its own block item again; that destroys a crop that is meant to be picked (a tomato vine) and harvests a growing
 * stage that turns into another block by itself (a budding tomato). Register with {@link McbotApi#registerCropRule}.
 *
 * <p>Fail closed like every adapter: return {@code null} from {@link #harvest} for any block or version you did not
 * verify, and the generic rules apply as before. Vanilla blocks never reach a rule. Methods that throw count as
 * "no rule".</p>
 */
public interface CropRule {
    enum Harvest {
        /**
         * Picked with a right-click (any held item but bone meal, or an empty hand) once {@link #ripe}; the plant stays
         * and grows again, like sweet berries. Never broken, never replanted.
         */
        PICK,
        /** A growing stage that becomes another block by itself: never harvested; bone meal is still allowed. */
        GROWING
    }

    /** Stable id, namespace = the adapted mod, e.g. {@code farmersdelight:tomatoes}. */
    String id();

    /** True only when the adapted mod is present at exactly the verified version ({@link McbotApi#versionsMatch}). */
    boolean installed();

    /** How to treat this block state, or {@code null} when this rule does not cover it. */
    Harvest harvest(BlockState state);

    /** For {@link Harvest#PICK}: whether it can be picked right now. */
    default boolean ripe(BlockState state) { return false; }
}
