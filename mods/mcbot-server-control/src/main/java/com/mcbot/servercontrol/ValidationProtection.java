package com.mcbot.servercontrol;

import java.util.UUID;
import com.google.gson.JsonObject;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.block.Blocks;
import static com.mcbot.servercontrol.Protocol.obj;

/**
 * Disabled by default; isolated tests can change a physical marker through their fixture setup. The loader's event bridge
 * asks it about block breaks, placements and right-clicks (normal priority) and cancels the event when it refuses.
 */
final class ValidationProtection {
    private final boolean enabled=Boolean.getBoolean("mcbot.validationFixture");
    private final UUID uuid;
    private static final BlockPos TARGET=new BlockPos(516,201,512), MARKER=new BlockPos(516,199,512);
    private long breakCancelled,placeCancelled,rightClickCancelled;
    ValidationProtection(UUID uuid) { this.uuid=uuid; }
    boolean refusesBreak(Entity player,BlockPos pos,LevelAccessor level) {
        if(enabled&&uuid.equals(player.getUUID())&&pos.equals(TARGET)&&level.getBlockState(MARKER).is(Blocks.REDSTONE_BLOCK)) { breakCancelled++; return true; }
        return false;
    }
    boolean refusesPlace(Entity entity,BlockPos pos,LevelAccessor level) {
        if(enabled&&entity!=null&&uuid.equals(entity.getUUID())&&pos.equals(TARGET)&&level.getBlockState(MARKER).is(Blocks.GOLD_BLOCK)) { placeCancelled++; return true; }
        return false;
    }
    boolean refusesRightClick(Entity player,BlockPos pos,Direction face,LevelAccessor level) {
        boolean target=pos.equals(TARGET)||(face!=null&&pos.relative(face).equals(TARGET));
        if(enabled&&uuid.equals(player.getUUID())&&target&&level.getBlockState(MARKER).is(Blocks.DIAMOND_BLOCK)) { rightClickCancelled++; return true; }
        return false;
    }
    boolean enabled() { return enabled; }
    JsonObject json() { return obj("enabled",enabled,"breakCancelled",breakCancelled,"placeCancelled",placeCancelled,"rightClickCancelled",rightClickCancelled); }
}
