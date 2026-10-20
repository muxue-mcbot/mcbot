package com.mcbot.servercontrol;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.CollisionGetter;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.pathfinder.PathType;
import net.minecraft.world.level.pathfinder.WalkNodeEvaluator;

/**
 * Version shim for MC 1.21.1: what the route evaluator in {@link NativeNavigation} reads from vanilla's walk evaluator
 * while a search runs (1.21 keeps it in a PathfindingContext, 1.20.1 in the evaluator itself).
 */
abstract class RouteEvaluatorBase extends WalkNodeEvaluator {
    /** The cell type of a block for the searching mob, cached for this search. */
    final PathType cachedType(int x, int y, int z) { return getCachedPathType(x, y, z); }

    /** A block of the region being searched. */
    final BlockState blockAt(BlockPos pos) { return currentContext.getBlockState(pos); }

    /** The region being searched, for collision shapes. */
    final CollisionGetter region() { return currentContext.level(); }
}
