package com.mcbot.servercontrol;

import com.mojang.brigadier.arguments.BoolArgumentType;
import com.mojang.brigadier.arguments.FloatArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import com.mojang.brigadier.CommandDispatcher;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;
import static com.mcbot.servercontrol.Protocol.*;

/**
 * Test fixture only: ordinary spawnpoint forces its point, so it cannot test a missing bed. The loader's event bridge
 * hands it the command dispatcher and the player clone and respawn events.
 */
final class RespawnValidationFixture {
    private static final boolean ENABLED=Boolean.getBoolean("mcbot.validationFixture");
    private static int deathClones,respawnEvents;
    private RespawnValidationFixture() { }
    static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        if(!ENABLED) return;
        dispatcher.register(Commands.literal("mcbot-respawn-fixture").requires(source->source.hasPermission(4))
            .then(Commands.literal("status").executes(context->status(context.getSource())))
            .then(Commands.literal("clear").executes(context->{
                BodyPlayer player=body(context.getSource());
                player.setRespawnPosition(context.getSource().getLevel().dimension(),null,0,false,false);
                return status(context.getSource());
            }))
            .then(Commands.literal("set")
                .then(Commands.argument("x",IntegerArgumentType.integer(-29_999_000,29_999_000))
                .then(Commands.argument("y",IntegerArgumentType.integer(-64,1000))
                .then(Commands.argument("z",IntegerArgumentType.integer(-29_999_000,29_999_000))
                .then(Commands.argument("forced",BoolArgumentType.bool())
                .then(Commands.argument("angle",FloatArgumentType.floatArg(-360,360))
                    .executes(context->{
                        BodyPlayer player=body(context.getSource());
                        player.setRespawnPosition(context.getSource().getLevel().dimension(),
                            new BlockPos(IntegerArgumentType.getInteger(context,"x"),IntegerArgumentType.getInteger(context,"y"),IntegerArgumentType.getInteger(context,"z")),
                            FloatArgumentType.getFloat(context,"angle"),BoolArgumentType.getBool(context,"forced"),false);
                        return status(context.getSource());
                    }))))))));
    }
    private static BodyPlayer body(CommandSourceStack source) {
        var player=source.getServer().getPlayerList().getPlayerByName("Claude");
        if(!(player instanceof BodyPlayer body)) throw error("INVALID_ARGUMENT","Validation requires the Claude BodyPlayer");
        return body;
    }
    private static int status(CommandSourceStack source) {
        BodyPlayer player=body(source);
        BlockPos pos=player.getRespawnPosition();
        var json=obj("enabled",true,"uuid",player.getUUID().toString(),"bodyClass",player.getClass().getSimpleName(),
            "registered",source.getServer().getPlayerList().getPlayers().stream().filter(p->p.getUUID().equals(player.getUUID())).count(),
            "dimension",player.getRespawnDimension().location().toString(),"forced",player.isRespawnForced(),"angle",player.getRespawnAngle(),
            "position",pos==null?null:obj("x",pos.getX(),"y",pos.getY(),"z",pos.getZ()),
            "deathClones",deathClones,"respawnEvents",respawnEvents,"alive",player.isAlive());
        source.sendSuccess(()->Component.literal("MCBOT_RESPAWN_FIXTURE "+JSON.toJson(json)),false);
        return 1;
    }
    static void cloned(Player player,Player original,boolean wasDeath) {
        if(ENABLED&&player instanceof BodyPlayer&&original!=player&&wasDeath) deathClones++;
    }
    static void respawned(Player player,boolean endConquered) {
        if(ENABLED&&player instanceof BodyPlayer&&!endConquered) respawnEvents++;
    }
}
