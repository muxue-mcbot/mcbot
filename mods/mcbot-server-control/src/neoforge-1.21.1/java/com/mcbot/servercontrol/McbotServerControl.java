package com.mcbot.servercontrol;

import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.TriState;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.ServerChatEvent;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import net.neoforged.neoforge.event.entity.living.*;
import net.neoforged.neoforge.event.entity.player.*;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.event.server.*;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.bus.api.EventPriority;
import java.io.IOException;

/**
 * NeoForge 1.21.1 entry point and event bridge (version folder neoforge-1.21.1): the only place that listens to NeoForge
 * events. Each listener hands plain values to the current {@link ServerController} (none between worlds) and cancels
 * when it refuses; priorities and receiving cancelled events are part of the behaviour, keep them in every version.
 */
@Mod("mcbot_server_control")
public final class McbotServerControl {
    private static final org.slf4j.Logger LOGGER=com.mojang.logging.LogUtils.getLogger();
    private ServerController controller;
    private LocalHttpBridge bridge;
    private CommandFileFixture fixture;
    static { com.mcbot.servercontrol.platform.LoaderPlatform.install(NeoForgePlatform.INSTANCE); }
    public McbotServerControl() {
        var bus=NeoForge.EVENT_BUS;
        bus.addListener(this::started);
        bus.addListener(this::stopping);
        bus.addListener(this::beforeTick);
        bus.addListener(EventPriority.LOWEST,this::chat);
        bus.addListener(EventPriority.LOWEST,this::pickup);
        bus.addListener(EventPriority.HIGHEST,(ItemEntityPickupEvent.Pre event)->pickupPre(event,true));
        bus.addListener(EventPriority.LOWEST,(ItemEntityPickupEvent.Pre event)->pickupPre(event,false));
        bus.addListener(EventPriority.LOWEST,this::foodFinish);
        bus.addListener(EventPriority.LOWEST,this::damage);
        bus.addListener(EventPriority.LOWEST,true,this::attackGuard);
        bus.addListener(EventPriority.LOWEST,true,this::incomingDamageGuard);
        bus.addListener(EventPriority.LOWEST,true,this::sweepGuard);
        bus.addListener(EventPriority.HIGHEST,this::trampleGuard);
        bus.addListener(EventPriority.HIGHEST,this::friendlyFireGuard);
        bus.addListener(EventPriority.HIGHEST,this::projectileMark);
        bus.addListener(EventPriority.LOWEST,this::death);
        bus.addListener(EventPriority.LOWEST,this::drops);
        bus.addListener(this::validationBreak);
        bus.addListener(this::validationPlace);
        bus.addListener(this::validationRightClick);
        bus.addListener((RegisterCommandsEvent event)->RespawnValidationFixture.register(event.getDispatcher()));
        bus.addListener((PlayerEvent.Clone event)->RespawnValidationFixture.cloned(event.getEntity(),event.getOriginal(),event.isWasDeath()));
        bus.addListener((PlayerEvent.PlayerRespawnEvent event)->RespawnValidationFixture.respawned(event.getEntity(),event.isEndConquered()));
    }
    private void started(ServerStartedEvent event) {
        var directory=FMLPaths.CONFIGDIR.get().resolve("mcbot-server-control");
        try {
            var server=event.getServer();
            ServerConfig loaded=ServerConfig.load(directory,server.isDedicatedServer());
            ServerConfig config=loaded.withWorldId(HostingRules.worldId(loaded.worldId(),server.isDedicatedServer(),server.getWorldPath(LevelResource.ROOT)));
            // Add-on registration closes here; JSON interactions are read from config/mcbot-server-control/interactions.
            var adapters=ModAdapters.load(directory);
            for(String problem:adapters.problems()) LOGGER.warn("MCBOT adapter: {}",problem);
            LOGGER.info("MCBOT adapters: containers {}, interactions {}, workstations {}, generic item handlers {}",adapters.containers().stream().map(a->a.id()).toList(),
                ItemInteractions.ids(ItemInteractions.installed()),ModAdapters.workstationIds(),ModAdapters.itemHandlerMods());
            controller=new ServerController(event.getServer(),config);
            bridge=new LocalHttpBridge(directory,config,event.getServer()::execute,controller::call);
            fixture=CommandFileFixture.start(server);
        } catch(java.net.BindException e) {
            // Another world (a singleplayer client with this mod, a second server) already holds the port:
            // the game keeps running without local control rather than refusing to start.
            if(controller!=null) controller.close(); controller=null;
            LOGGER.error("MCBOT local server control is off: port in use, set another port in config/mcbot-server-control/server.json ({})",e.getMessage());
        } catch(IOException|RuntimeException e) {
            controller=null;
            throw new IllegalStateException("MCBOT local server control could not start (check server.json or port)",e);
        }
    }
    private void beforeTick(ServerTickEvent.Pre event) { if(controller!=null) controller.beforeServerTick(); }
    private void chat(ServerChatEvent event) {
        if(controller!=null&&!NeoForgePlatform.INSTANCE.ownChat(event)&&!event.isCanceled()) controller.receiveChat(event.getUsername(),event.getMessage().getString());
    }
    private void pickupPre(ItemEntityPickupEvent.Pre event,boolean first) {
        if(controller!=null) controller.receivePickupPre(event.getPlayer(),event.getItemEntity(),event,first,event.canPickup()==TriState.FALSE);
    }
    private void pickup(ItemEntityPickupEvent.Post event) {
        if(controller!=null) controller.receivePickup(event.getPlayer(),event.getItemEntity(),event.getOriginalStack(),event.getCurrentStack());
    }
    private void foodFinish(LivingEntityUseItemEvent.Finish event) {
        if(controller!=null) controller.receiveFoodFinish(event.getEntity(),event.getHand(),event.getItem(),event.getResultStack());
    }
    private void damage(LivingDamageEvent.Post event) { if(controller!=null) controller.receiveDamage(event.getSource(),event.getEntity(),event.getNewDamage()); }
    private void attackGuard(AttackEntityEvent event) {
        if(controller!=null&&SurvivalActions.refusesNativeAttack(event.getEntity(),event.getTarget())) event.setCanceled(true);
    }
    private void incomingDamageGuard(LivingIncomingDamageEvent event) {
        if(controller!=null&&SurvivalActions.refusesNativeIncomingDamage(event.getSource(),event.getEntity())) event.setCanceled(true);
    }
    private void sweepGuard(SweepAttackEvent event) {
        if(controller!=null&&SurvivalActions.refusesNativeSweep(event.getEntity())) { event.setSweeping(false); event.setCanceled(true); }
    }
    private void trampleGuard(BlockEvent.FarmlandTrampleEvent event) { if(controller!=null&&controller.refusesTrample(event.getEntity())) event.setCanceled(true); }
    private void friendlyFireGuard(LivingIncomingDamageEvent event) {
        if(controller!=null&&controller.refusesFriendlyFire(event.getSource(),event.getEntity())) event.setCanceled(true);
    }
    private void projectileMark(EntityJoinLevelEvent event) { if(controller!=null&&!event.getLevel().isClientSide()) controller.markBodyProjectile(event.getEntity()); }
    private void death(LivingDeathEvent event) { if(controller!=null) controller.recordDeath(event.getEntity(),event.getSource()); }
    private void drops(LivingDropsEvent event) { if(controller!=null) controller.recordDrops(event.getEntity(),event.getDrops()); }
    private void validationBreak(BlockEvent.BreakEvent event) {
        if(controller!=null&&controller.validationProtection().refusesBreak(event.getPlayer(),event.getPos(),event.getLevel())) event.setCanceled(true);
    }
    private void validationPlace(BlockEvent.EntityPlaceEvent event) {
        if(controller!=null&&controller.validationProtection().refusesPlace(event.getEntity(),event.getPos(),event.getLevel())) event.setCanceled(true);
    }
    private void validationRightClick(PlayerInteractEvent.RightClickBlock event) {
        if(controller!=null&&controller.validationProtection().refusesRightClick(event.getEntity(),event.getPos(),event.getFace(),event.getLevel())) event.setCanceled(true);
    }
    private void stopping(ServerStoppingEvent event) {
        if(fixture!=null) fixture.close(); fixture=null;
        if(bridge!=null) bridge.close(); bridge=null;
        if(controller!=null) controller.close(); controller=null;
    }
}
