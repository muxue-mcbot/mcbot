package com.mcbot.servercontrol;

import net.minecraft.network.DisconnectionDetails;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

/**
 * Version shim for MC 1.21.1: joining the body to the server and the game listener under {@link VirtualGameListener}.
 * Since 1.20.2 a player joins with a {@link CommonListenerCookie} (what the configuration phase settled).
 */
abstract class GameListenerBase extends ServerGamePacketListenerImpl {
    GameListenerBase(MinecraftServer server, VirtualConnection sink, ServerPlayer player) {
        super(server, sink, player, cookie(player));
    }

    /** Joins the body as vanilla joins a player that finished logging in (loads its save, sends the world, fires events). */
    static void placeNewPlayer(MinecraftServer server, VirtualConnection sink, ServerPlayer player) {
        server.getPlayerList().placeNewPlayer(sink, player, cookie(player));
    }

    /** Takes the body out as a disconnecting player (saves it, removes it from the list and the level). */
    static void disconnect(ServerGamePacketListenerImpl listener, Component reason) {
        listener.onDisconnect(new DisconnectionDetails(reason));
    }

    private static CommonListenerCookie cookie(ServerPlayer player) { return CommonListenerCookie.createInitial(player.getGameProfile(), false); }
}
