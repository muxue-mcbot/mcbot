package com.mcbot.addon.farmersdelight;

import com.google.gson.JsonObject;
import com.mcbot.servercontrol.api.ItemInteraction;
import com.mcbot.servercontrol.api.McbotApi;
import java.util.List;
import java.util.function.BiFunction;
import java.util.function.BiPredicate;
import java.util.function.Function;
import java.util.function.Predicate;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.FireChargeItem;
import net.minecraft.world.item.FlintAndSteelItem;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.common.Tags;

/**
 * Right-clicks on Farmer's Delight blocks, used with MCBOT's interact-block: put an ingredient on the cutting board,
 * cut it with the recipe's tool, take it back; serve a feast; slice a pie; light a stove; put food into a skillet (and
 * take it back); cut a mushroom off a colony with shears. MCBOT sends the player's own click and accepts
 * the result only when every observed change lies inside the envelope {@link FdRules} gives.
 */
final class FdInteractions {
    private FdInteractions() {}

    private interface Refusal { String why(JsonObject summary, ServerPlayer player, BlockPos position, ItemStack held); }

    private record Step(String id, Predicate<BlockState> blocks, boolean emptyHand, Predicate<ItemStack> held,
                        BiFunction<ServerLevel, BlockPos, JsonObject> read, Refusal refusal,
                        Function<JsonObject, Expected> envelope, BiPredicate<JsonObject, JsonObject> check) implements ItemInteraction {
        public String kind() { return BLOCK; }
        public boolean installed() { return FdAccess.installed(); }
        public boolean block(BlockState state) { return blocks.test(state); }
        public boolean accepts(ItemStack stack) { return held.test(stack); }
        public void precondition(ServerPlayer player, BlockPos position, BlockState state, ItemStack stack) {
            String why = refusal.why(read.apply(player.serverLevel(), position), player, position, stack);
            if (why != null) throw McbotApi.refuse("INTERACTION_NOT_READY", why);
        }
        public JsonObject summary(ServerPlayer player, BlockPos position) { return read.apply(player.serverLevel(), position); }
        /** Without a concrete state nothing is allowed; MCBOT uses {@link #expectedFor} for every real use. */
        public Expected expected() { return new Expected(0, 0, false, java.util.Set.of(), java.util.Set.of(), java.util.Set.of(), false); }
        public Expected expectedFor(JsonObject before) { return envelope.apply(before); }
        /** MCBOT passes whole snapshots; the rules work on the adapter summaries inside them. */
        public boolean consistent(JsonObject before, JsonObject after) { return check.test(before.getAsJsonObject("summary"), after.getAsJsonObject("summary")); }
    }

    private static boolean board(BlockState state) { return FdAccess.is(state, FdAccess.CUTTING_BOARD_ID, FdAccess.CUTTING_BOARD_CLASS); }

    static final ItemInteraction PLACE = new Step("farmersdelight:cutting_board/place", FdInteractions::board, false, s -> !s.isEmpty(),
        FdAccess::boardSummary,
        (s, p, pos, h) -> FdRules.placeRefusal(s, FdAccess.cuttable(p.serverLevel(), h), FdAccess.offhandTakesOver(p, h)),
        b -> FdRules.PLACE, FdRules::placed);
    static final ItemInteraction CUT = new Step("farmersdelight:cutting_board/cut", FdInteractions::board, false, s -> !s.isEmpty(),
        FdAccess::boardSummary,
        (s, p, pos, h) -> FdRules.cutRefusal(s, FdAccess.fitsBoard(p.serverLevel(), FdAccess.stored(FdAccess.board(p.serverLevel(), pos)), h)),
        FdRules::cut, FdRules::emptied);
    static final ItemInteraction TAKE = new Step("farmersdelight:cutting_board/take", FdInteractions::board, true, s -> s.isEmpty(),
        FdAccess::boardSummary, (s, p, pos, h) -> FdRules.takeRefusal(s), FdRules::take, FdRules::emptied);
    static final ItemInteraction SERVE = new Step("farmersdelight:feast/serve", s -> FdAccess.extendsClass(s, FdAccess.FEAST_CLASS), false, s -> !s.isEmpty(),
        FdAccess::feastSummary, (s, p, pos, h) -> FdRules.serveRefusal(s, FdAccess.id(h)), FdRules::serve, FdRules::served);
    static final ItemInteraction SLICE = new Step("farmersdelight:pie/slice", s -> FdAccess.extendsClass(s, FdAccess.PIE_CLASS), false, s -> s.is(FdAccess.KNIVES),
        FdAccess::pieSummary, (s, p, pos, h) -> FdRules.sliceRefusal(s, h.is(FdAccess.KNIVES)), FdRules::slice, FdRules::sliced);

    private static boolean stove(BlockState state) { return FdAccess.is(state, FdAccess.STOVE_ID, FdAccess.STOVE_CLASS); }
    private static boolean skillet(BlockState state) { return FdAccess.is(state, FdAccess.SKILLET_ID, FdAccess.SKILLET_CLASS); }

    static final ItemInteraction STOVE_LIGHT = new Step("farmersdelight:stove/light", FdInteractions::stove, false,
        s -> s.getItem() instanceof FlintAndSteelItem || s.getItem() instanceof FireChargeItem,
        FdAccess::stoveSummary, (s, p, pos, h) -> FdRules.lightRefusal(s), b -> FdRules.STOVE_LIGHT, FdRules::lit);
    static final ItemInteraction SKILLET_ADD = new Step("farmersdelight:skillet/add", FdInteractions::skillet, false, s -> !s.isEmpty(),
        FdAccess::skilletSummary, (s, p, pos, h) -> FdRules.skilletAddRefusal(s, FdAccess.cooksOnFire(p.serverLevel(), h)),
        b -> FdRules.SKILLET_ADD, FdRules::skilletLoaded);
    static final ItemInteraction SKILLET_TAKE = new Step("farmersdelight:skillet/take", FdInteractions::skillet, true, ItemStack::isEmpty,
        FdAccess::skilletSummary, (s, p, pos, h) -> FdRules.skilletTakeRefusal(s), FdRules::skilletTake, FdRules::skilletEmptied);
    static final ItemInteraction COLONY = new Step("farmersdelight:mushroom_colony/harvest", FdAccess::colony, false, s -> s.is(Tags.Items.TOOLS_SHEAR),
        FdAccess::colonySummary, (s, p, pos, h) -> FdRules.colonyRefusal(s), FdRules::colonyHarvest, FdRules::colonyHarvested);

    static List<ItemInteraction> all() { return List.of(PLACE, CUT, TAKE, SERVE, SLICE, STOVE_LIGHT, SKILLET_ADD, SKILLET_TAKE, COLONY); }
}
