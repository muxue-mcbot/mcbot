package com.mcbot.servercontrol;

import com.mojang.authlib.GameProfile;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

/** Version shim for MC 1.21.1: the one constructor seam of vanilla respawn ({@link NativeRespawn}). */
public final class RespawnSeam {
    private RespawnSeam() { }

    /** Called only by PlayerListRespawnMixin at vanilla's new ServerPlayer expression: a body stays a body. */
    public static ServerPlayer replacement(MinecraftServer server, ServerLevel level, GameProfile profile,
                                           ClientInformation information, ServerPlayer previous) {
        return previous instanceof BodyPlayer body
            ? body.createRespawnReplacement(server, level, profile, information)
            : new ServerPlayer(server, level, profile, information);
    }
}
