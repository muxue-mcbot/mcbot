package com.mcbot.servercontrol;

import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.level.pathfinder.PathType;
import net.minecraft.world.level.pathfinder.WalkNodeEvaluator;

/**
 * Version shim for MC 1.21.1: vanilla's path cell types (PathType since 1.20.5, BlockPathTypes before; same constant
 * names). The shared code holds them in {@code var} locals and compares with these constants (see {@link Version}).
 */
final class VersionPath {
    private VersionPath() {}

    static final PathType OPEN = PathType.OPEN, WALKABLE = PathType.WALKABLE, BLOCKED = PathType.BLOCKED,
        WATER = PathType.WATER, WATER_BORDER = PathType.WATER_BORDER,
        DANGER_FIRE = PathType.DANGER_FIRE, DAMAGE_FIRE = PathType.DAMAGE_FIRE,
        DANGER_POWDER_SNOW = PathType.DANGER_POWDER_SNOW, POWDER_SNOW = PathType.POWDER_SNOW,
        DANGER_OTHER = PathType.DANGER_OTHER, DAMAGE_OTHER = PathType.DAMAGE_OTHER;

    /** What a walking mob makes of this block (the mob's size and the blocks around decide). */
    static PathType typeAt(Mob mob, BlockPos pos) { return WalkNodeEvaluator.getPathTypeStatic(mob, pos); }
}
