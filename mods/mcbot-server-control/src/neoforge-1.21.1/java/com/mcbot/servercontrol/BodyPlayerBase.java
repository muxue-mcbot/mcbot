package com.mcbot.servercontrol;

import com.mojang.authlib.GameProfile;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;

/** Version shim for MC 1.21.1: the ServerPlayer constructor and movement tracking under {@link BodyPlayer}. */
abstract class BodyPlayerBase extends ServerPlayer {
    /** clientInformation: the settings vanilla carries over on respawn ({@link ClientInformation}), or null for a new body. */
    BodyPlayerBase(MinecraftServer server, ServerLevel level, GameProfile profile, Object clientInformation) {
        super(server, level, profile, clientInformation == null ? ClientInformation.createDefault() : (ClientInformation) clientInformation);
    }

    /** What the body moved this tick, for the server's own velocity tracking (since 1.21). */
    final void knownMovement(Vec3 moved) { setKnownMovement(moved); }
}
