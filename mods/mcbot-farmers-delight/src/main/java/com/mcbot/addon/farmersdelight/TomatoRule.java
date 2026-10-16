package com.mcbot.addon.farmersdelight;

import com.mcbot.servercontrol.api.CropRule;
import net.minecraft.world.level.block.CropBlock;
import net.minecraft.world.level.block.state.BlockState;

/** tend-crops picks ripe tomato vines instead of breaking them and leaves budding tomatoes to grow ({@link FdRules#tomato}). */
final class TomatoRule implements CropRule {
    static final TomatoRule INSTANCE = new TomatoRule();
    private TomatoRule() {}
    public String id() { return "farmersdelight:tomatoes"; }
    public boolean installed() { return FdAccess.installed(); }
    public Harvest harvest(BlockState state) { return FdRules.tomato(FdAccess.id(state.getBlock()), state.getBlock().getClass().getName()); }
    /** The vine's own test (TomatoVineBlock#useWithoutItem picks only at its maximum age). */
    public boolean ripe(BlockState state) { return harvest(state) == Harvest.PICK && state.getBlock() instanceof CropBlock vine && vine.isMaxAge(state); }
}
