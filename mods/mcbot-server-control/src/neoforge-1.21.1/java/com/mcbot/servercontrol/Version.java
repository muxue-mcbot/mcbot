package com.mcbot.servercontrol;

import java.io.IOException;
import java.nio.file.Path;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.network.protocol.game.ServerboundUseItemPacket;
import net.minecraft.world.InteractionHand;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Leashable;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.monster.breeze.Breeze;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.level.block.BaseTorchBlock;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.BonemealableBlock;
import net.minecraft.world.level.block.LiquidBlockContainer;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.material.Fluid;

/**
 * Version shim for MC 1.21.1 (version folder neoforge-1.21.1): small vanilla calls whose names or signatures differ
 * between the game versions the core supports. Every version folder has a class of this name with the same methods;
 * the shared code calls it and each build compiles exactly one (docs/forge_1201_port.md).
 */
final class Version {
    private Version() {}

    /** How far the player reaches blocks, from the eyes (attribute since 1.20.5). */
    static double blockReach(Player player) { return player.blockInteractionRange(); }

    /** How far the player reaches entities, from the eyes. */
    static double entityReach(Player player) { return player.entityInteractionRange(); }

    /** Whether the entity's bounding box is within the player's entity reach, as vanilla checks an attack or interaction. */
    static boolean canReachEntity(Player player, Entity entity) { return player.canInteractWithEntity(entity, 0); }

    /** Same item with the same data (components since 1.20.5, NBT before): two stacks that would merge. */
    static boolean sameItem(ItemStack a, ItemStack b) { return ItemStack.isSameItemSameComponents(a, b); }

    /** Whether the held tool gets drops from this block here (NeoForge's position-sensitive check). */
    static boolean correctToolForDrops(Player player, BlockState state, Level level, BlockPos pos) { return player.hasCorrectToolForDrops(state, level, pos); }

    /** Whether a waterloggable block takes this fluid from this player's bucket. */
    static boolean canPlaceLiquid(LiquidBlockContainer block, Player player, BlockGetter level, BlockPos pos, BlockState state, Fluid fluid) {
        return block.canPlaceLiquid(player, level, pos, state, fluid);
    }

    /** Whether bone meal would do something to this block (server side). */
    static boolean validBonemealTarget(BonemealableBlock block, LevelReader level, BlockPos pos, BlockState state) {
        return block.isValidBonemealTarget(level, pos, state);
    }

    /** The only player a dropped item may be picked up by (thrown by /give or a mod to someone), or null for anyone. */
    static UUID pickupTarget(ItemEntity item) { return item.getTarget(); }

    /** The packet a client sends to use the item in a hand (right-click in the air), facing where the body faces. */
    static ServerboundUseItemPacket useItemPacket(InteractionHand hand, int sequence, float yRot, float xRot) {
        return new ServerboundUseItemPacket(hand, sequence, yRot, xRot);
    }

    /** A compressed NBT file such as a player save, without a size limit. */
    static CompoundTag readCompressedNbt(Path file) throws IOException { return NbtIo.readCompressed(file, NbtAccounter.unlimitedHeap()); }

    /** Whether the game is paused (a singleplayer world with its menu open). */
    static boolean paused(MinecraftServer server) { return server.isPaused(); }

    /** Whether every player may use commands (a LAN world opened with cheats on). */
    static boolean commandsForAllPlayers(MinecraftServer server) { return server.getPlayerList().isAllowCommandsForAllPlayers(); }

    /** Held to something by a lead (any leashable entity since 1.21). */
    static boolean leashed(Entity entity) { return entity instanceof Leashable leashed && leashed.isLeashed(); }

    /** A breeze (1.21): it keeps its distance and deflects arrows, so hunting it is refused. */
    static boolean breeze(Entity entity) { return entity instanceof Breeze; }

    /** A torch of any kind, standing or on a wall. */
    static boolean torch(Block block) { return block instanceof BaseTorchBlock; }

    /** A trial spawner or vault (1.21), which look-around reports with the spawners. */
    static boolean trialBlock(Block block) { return block == Blocks.TRIAL_SPAWNER || block == Blocks.VAULT; }
}
