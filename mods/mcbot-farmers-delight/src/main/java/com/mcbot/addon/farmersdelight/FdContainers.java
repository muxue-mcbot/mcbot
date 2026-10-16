package com.mcbot.addon.farmersdelight;

import com.mcbot.servercontrol.api.ContainerAdapter;
import java.util.function.Predicate;
import net.minecraft.world.Container;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Cabinets and the basket as storage the bot can find, open and use like a chest. Both open (empty hand) the vanilla
 * three-row chest menu on the block entity itself (ChestMenu.threeRows in CabinetBlockEntity and BasketBlockEntity
 * 1.2.9), which MCBOT already checks slot by slot as it checks a barrel's; the adapter only vouches for the block and
 * its entity class.
 */
final class FdContainers {
    private FdContainers() {}

    private record Storage(String id, Predicate<BlockState> blocks, String entityClass) implements ContainerAdapter {
        public boolean installed() { return FdAccess.installed(); }
        public boolean block(BlockState state) { return blocks.test(state); }
        public boolean entity(BlockEntity entity) { return entity != null && entityClass.equals(entity.getClass().getName()); }
        /** A vanilla chest menu never reaches an adapter; MCBOT's own chest contract covers it. */
        public boolean menu(AbstractContainerMenu menu) { return false; }
        public Container storage(AbstractContainerMenu menu, Inventory inventory) { return null; }
    }

    static final ContainerAdapter CABINET = new Storage("farmersdelight:cabinet", FdAccess::cabinet, FdAccess.CABINET_ENTITY);
    static final ContainerAdapter BASKET = new Storage("farmersdelight:basket",
        s -> FdAccess.is(s, FdAccess.BASKET_ID, FdAccess.BASKET_CLASS), FdAccess.BASKET_ENTITY);
}
