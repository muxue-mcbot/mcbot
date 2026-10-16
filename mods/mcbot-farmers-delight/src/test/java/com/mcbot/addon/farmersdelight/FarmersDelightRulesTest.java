package com.mcbot.addon.farmersdelight;

import com.google.gson.JsonObject;
import com.mcbot.servercontrol.api.CropRule;
import com.mcbot.servercontrol.api.ItemInteraction.Expected;
import java.util.List;
import java.util.Set;

/** Offline checks of the Farmer's Delight rules on summaries; no Minecraft launch, no Farmer's Delight classes. */
final class FarmersDelightRulesTest {
    private static int checks;
    private static void check(boolean ok, String message) { checks++; if (!ok) throw new AssertionError(message); }

    public static void main(String[] ignored) {
        board();
        feasts();
        pies();
        tomatoes();
        cookingPot();
        stove();
        skillet();
        colonies();
        check(McbotFarmersDelight.HINT.length() <= com.mcbot.servercontrol.api.McbotApi.HINT_MAX, "the hint fits (registerHint refuses longer text at startup)");
        System.out.println("FarmersDelightRulesTest: " + checks + " checks passed (cutting board, feasts, pies, tomatoes, cooking pot, stove, skillet, mushroom colonies; no Minecraft launch)");
    }

    private static void board() {
        List<String> knives = List.of("farmersdelight:flint_knife", "farmersdelight:iron_knife");
        JsonObject empty = FdRules.board("", false, List.of(), List.of());
        JsonObject cabbage = FdRules.board("farmersdelight:cabbage", false, knives, List.of("farmersdelight:cabbage_leaf"));
        JsonObject stick = FdRules.board("minecraft:stick", false, List.of(), List.of());
        JsonObject carving = FdRules.board("farmersdelight:iron_knife", true, List.of(), List.of());

        check(FdRules.placeRefusal(empty, true, false) == null, "a cuttable item goes on an empty board");
        check(FdRules.placeRefusal(cabbage, true, false).contains("already holds farmersdelight:cabbage"), "one item at a time");
        check(FdRules.placeRefusal(empty, false, false).contains("Nothing is cut"), "only recipe inputs go on the board");
        check(FdRules.placeRefusal(empty, true, true).contains("off hand"), "a non-equipment off-hand item would take the click");
        check(FdRules.PLACE.minConsumed() == 1 && FdRules.PLACE.maxConsumed() == 1 && !FdRules.PLACE.heldDamageAllowed(), "placing uses exactly one item");
        check(FdRules.placed(empty, cabbage) && !FdRules.placed(empty, empty) && !FdRules.placed(cabbage, cabbage), "placed means empty before, an item after");

        check(FdRules.cutRefusal(empty, true).contains("empty"), "nothing to cut on an empty board");
        check(FdRules.cutRefusal(carving, true).contains("shows a tool"), "a knife laid on the board is not cut");
        check(FdRules.cutRefusal(stick, true).contains("No cutting recipe"), "an item without a recipe is not cut");
        String wrongTool = FdRules.cutRefusal(cabbage, false);
        check(wrongTool.contains("farmersdelight:flint_knife") && wrongTool.contains("farmersdelight:iron_knife"), "the wrong tool is refused, naming the right ones");
        check(FdRules.cutRefusal(cabbage, true) == null, "the right tool cuts");
        Expected cut = FdRules.cut(cabbage);
        check(cut.minConsumed() == 0 && cut.maxConsumed() == 1 && cut.heldDamageAllowed(), "cutting wears the tool and may break it");
        check(cut.gainedItems().equals(Set.of("farmersdelight:cabbage_leaf")), "the recipe's results may drop");
        check(cut.summaryFields().containsAll(Set.of("item", "tools", "results", "carving")) && cut.properties().isEmpty() && !cut.removesBlock(), "only the board's contents change");
        check(FdRules.emptied(cabbage, empty) && !FdRules.emptied(cabbage, cabbage) && !FdRules.emptied(empty, empty), "cut means the board was emptied");

        check(FdRules.takeRefusal(empty) != null && FdRules.takeRefusal(cabbage) == null, "taking needs something on the board");
        Expected take = FdRules.take(cabbage);
        check(take.gainedItems().equals(Set.of("farmersdelight:cabbage")) && take.minConsumed() == 0 && take.maxConsumed() == 0, "taking gives the stored item back");
        check(FdRules.take(empty).gainedItems().isEmpty(), "nothing to gain from an empty board");
    }

    private static void feasts() {
        JsonObject chicken = FdRules.feast("farmersdelight:roast_chicken_block", 4, "farmersdelight:roast_chicken", "minecraft:bowl", true);
        JsonObject lastChicken = FdRules.feast("farmersdelight:roast_chicken_block", 1, "farmersdelight:roast_chicken", "minecraft:bowl", true);
        JsonObject bones = FdRules.feast("farmersdelight:roast_chicken_block", 0, "farmersdelight:roast_chicken", "minecraft:bowl", true);
        JsonObject lastRolls = FdRules.feast("farmersdelight:rice_roll_medley_block", 1, "farmersdelight:salmon_roll", "", false);
        JsonObject gone = FdRules.feast("", 0, "", "", false);

        check(FdRules.serveRefusal(chicken, "minecraft:bowl") == null, "a bowl serves");
        check(FdRules.serveRefusal(chicken, "minecraft:stick").contains("minecraft:bowl"), "the wrong container is refused, naming the right one");
        check(FdRules.serveRefusal(bones, "minecraft:bowl").contains("leftovers"), "no serving from leftovers");
        check(FdRules.serveRefusal(gone, "minecraft:bowl").contains("Not a"), "a missing feast is refused");
        check(FdRules.serveRefusal(lastRolls, "minecraft:stick") == null, "a serving without a container needs only something in hand");
        Expected serve = FdRules.serve(chicken);
        check(serve.minConsumed() == 1 && serve.maxConsumed() == 1 && serve.gainedItems().equals(Set.of("farmersdelight:roast_chicken")) && serve.properties().equals(Set.of("servings")) && !serve.removesBlock(),
            "one bowl for one serving; the block stays");
        check(!FdRules.serve(lastChicken).removesBlock(), "a feast with leftovers stays after the last serving");
        Expected rolls = FdRules.serve(lastRolls);
        check(rolls.minConsumed() == 0 && rolls.maxConsumed() == 0 && rolls.removesBlock(), "no container used; the last serving of a feast without leftovers removes it");
        check(FdRules.served(chicken, FdRules.feast("farmersdelight:roast_chicken_block", 3, "farmersdelight:roast_chicken", "minecraft:bowl", true)), "one serving less");
        check(!FdRules.served(chicken, chicken), "unchanged is not served");
        check(FdRules.served(lastRolls, gone) && !FdRules.served(chicken, gone), "the block may vanish only after its last serving and only without leftovers");
        check(FdRules.served(lastChicken, bones), "the last serving leaves the leftovers");
    }

    private static void pies() {
        JsonObject pie = FdRules.pie("farmersdelight:apple_pie", 0, 4, "farmersdelight:apple_pie_slice");
        JsonObject lastSlice = FdRules.pie("farmersdelight:apple_pie", 3, 4, "farmersdelight:apple_pie_slice");
        JsonObject gone = FdRules.pie("", 0, 0, "");
        check(FdRules.sliceRefusal(pie, true) == null && FdRules.sliceRefusal(pie, false).contains("knife"), "slicing needs a knife");
        check(FdRules.sliceRefusal(gone, true).contains("Not a"), "a missing pie is refused");
        Expected slice = FdRules.slice(pie);
        check(slice.minConsumed() == 0 && slice.maxConsumed() == 0 && !slice.heldDamageAllowed() && slice.gainedItems().equals(Set.of("farmersdelight:apple_pie_slice")) && !slice.removesBlock(),
            "a slice drops, the knife is untouched, the pie stays");
        check(FdRules.slice(lastSlice).removesBlock(), "the last slice removes the pie");
        check(FdRules.sliced(pie, FdRules.pie("farmersdelight:apple_pie", 1, 4, "farmersdelight:apple_pie_slice")) && !FdRules.sliced(pie, pie), "one bite more");
        check(FdRules.sliced(lastSlice, gone) && !FdRules.sliced(pie, gone), "the pie may vanish only with its last slice");
    }

    private static void tomatoes() {
        check(FdRules.tomato(FdRules.TOMATOES, FdRules.VINE_CLASS) == CropRule.Harvest.PICK, "a tomato vine is picked");
        check(FdRules.tomato(FdRules.BUDDING_TOMATOES, FdRules.BUDDING_CLASS) == CropRule.Harvest.GROWING, "a budding tomato is left to grow");
        check(FdRules.tomato(FdRules.TOMATOES, "some.other.TomatoVineBlock") == null && FdRules.tomato("farmersdelight:cabbages", FdRules.VINE_CLASS) == null, "anything else keeps the generic rules");
    }

    private static void cookingPot() {
        check(FdRules.playerSlot(9) == 9 && FdRules.playerSlot(35) == 35 && FdRules.playerSlot(36) == 0 && FdRules.playerSlot(44) == 8, "player rows then hotbar, as CookingPotMenu adds them");
        List<String> expected = List.of("a", "a", "b");
        Object inventory = new Object(), other = new Object();
        check(FdRules.potSlots(List.of("a", "a", "b"), expected, List.of(inventory, inventory, inventory), inventory, List.of(0, 1, 2)), "verified classes on the pot's handler in order");
        check(!FdRules.potSlots(List.of("a", "b", "b"), expected, List.of(inventory, inventory, inventory), inventory, List.of(0, 1, 2)), "a different slot class is refused");
        check(!FdRules.potSlots(List.of("a", "a", "b"), expected, List.of(inventory, other, inventory), inventory, List.of(0, 1, 2)), "a slot on another handler is refused");
        check(!FdRules.potSlots(List.of("a", "a", "b"), expected, List.of(inventory, inventory, inventory), inventory, List.of(0, 2, 1)), "slots out of order are refused");
        check(!FdRules.potSlots(List.of("a", "a", "b"), expected, List.of(inventory, inventory, inventory), null, List.of(0, 1, 2)), "no handler, no pot");
        check(FdRules.potTicksLeft(3, 50, 200, true) == 150 + 2 * 200, "rest of this meal plus two more");
        check(FdRules.potTicksLeft(0, 0, 200, false) == 0, "nothing in: nothing left");
        check(FdRules.potTicksLeft(2, 0, 200, false) == -1 && FdRules.potTicksLeft(2, 0, 0, true) == -1, "not cooking, or no cook time yet: unknown");
    }

    private static void stove() {
        JsonObject lit = FdRules.stove(true, false, List.of("minecraft:beef"), 6, 450);
        JsonObject one = FdRules.stove(true, false, List.of("minecraft:beef", "minecraft:beef"), 6, 600);
        JsonObject full = FdRules.stove(true, false, List.of("a", "b", "c", "d", "e", "f"), 6, 10);
        JsonObject cold = FdRules.stove(false, false, List.of("minecraft:beef"), 6, 450);
        JsonObject covered = FdRules.stove(true, true, List.of(), 6, 0);
        check(lit.get("free").getAsInt() == 5 && lit.get("readyInSeconds").getAsInt() == 23, "five slots free; 450 ticks round up to 23 s");
        check(cold.get("readyInSeconds").getAsInt() == -1 && FdRules.stove(true, false, List.of(), 6, 0).get("readyInSeconds").getAsInt() == 0, "unlit with food: never; empty: nothing to wait for");
        check(FdRules.stoveAddRefusal(lit, true) == null, "raw food goes on a lit stove with room");
        check(FdRules.stoveAddRefusal(lit, false).contains("campfire recipe"), "only food with a campfire recipe");
        check(FdRules.stoveAddRefusal(cold, true).contains("stove/light"), "an unlit stove is refused, naming how to light it");
        check(FdRules.stoveAddRefusal(covered, true).contains("block above"), "a block on top stops the stove");
        check(FdRules.stoveAddRefusal(full, true).contains("full"), "six pieces at most");
        check(FdRules.STOVE_ADD.minConsumed() == 1 && FdRules.STOVE_ADD.maxConsumed() == 1 && FdRules.STOVE_ADD.properties().isEmpty() && FdRules.STOVE_ADD.gainedItems().isEmpty(), "one piece per click, nothing gained");
        check(FdRules.stoveAdded(lit, one) && !FdRules.stoveAdded(lit, lit) && !FdRules.stoveAdded(one, lit), "added means one more piece on it");
        check(FdRules.lightRefusal(cold) == null && FdRules.lightRefusal(lit).contains("already lit"), "only an unlit stove is lit");
        check(FdRules.STOVE_LIGHT.properties().equals(Set.of("lit")) && FdRules.STOVE_LIGHT.heldDamageAllowed() && FdRules.STOVE_LIGHT.maxConsumed() == 1 && FdRules.STOVE_LIGHT.gainedItems().isEmpty(),
            "flint and steel wears, a fire charge is used, nothing gained");
        check(FdRules.lit(cold, FdRules.stove(true, false, List.of("minecraft:beef"), 6, 450)) && !FdRules.lit(lit, lit), "lit means unlit before, lit after, same food");
    }

    private static void skillet() {
        JsonObject empty = FdRules.skillet("", 0, true, false, 0, 0);
        JsonObject beef = FdRules.skillet("minecraft:beef", 3, true, false, 20, 120);
        JsonObject coldBeef = FdRules.skillet("minecraft:beef", 3, false, false, 20, 120);
        check(beef.get("readyInSeconds").getAsInt() == (100 + 2 * 120) / 20 && beef.get("count").getAsInt() == 3, "the piece in progress plus two more");
        check(coldBeef.get("readyInSeconds").getAsInt() == -1 && empty.get("readyInSeconds").getAsInt() == 0 && empty.get("count").getAsInt() == 0, "no heat: never; empty: nothing");
        check(FdRules.skilletAddRefusal(empty, true) == null, "a heated empty skillet takes food");
        check(FdRules.skilletAddRefusal(empty, false).contains("campfire recipe"), "only food with a campfire recipe");
        check(FdRules.skilletAddRefusal(beef, true).contains("skillet/take"), "one stack at a time");
        check(FdRules.skilletAddRefusal(FdRules.skillet("", 0, false, false, 0, 0), true).contains("No heat"), "a cold skillet is refused");
        check(FdRules.skilletAddRefusal(FdRules.skillet("", 0, true, true, 0, 0), true).contains("under water"), "a waterlogged skillet is refused");
        check(FdRules.SKILLET_ADD.minConsumed() == 1 && FdRules.SKILLET_ADD.maxConsumed() == 64 && FdRules.SKILLET_ADD.gainedItems().isEmpty(), "the whole held stack goes in");
        check(FdRules.skilletLoaded(empty, beef) && !FdRules.skilletLoaded(beef, beef), "loaded means empty before");
        check(FdRules.skilletTakeRefusal(empty) != null && FdRules.skilletTakeRefusal(beef) == null, "taking needs something in it");
        check(FdRules.skilletTake(beef).gainedItems().equals(Set.of("minecraft:beef")) && FdRules.skilletTake(beef).maxConsumed() == 0, "taking gives the stack back");
        check(FdRules.skilletEmptied(beef, empty) && !FdRules.skilletEmptied(beef, beef), "taken means empty after");
    }

    private static void colonies() {
        JsonObject grown = FdRules.colony("farmersdelight:brown_mushroom_colony", 3, "minecraft:brown_mushroom");
        JsonObject young = FdRules.colony("farmersdelight:brown_mushroom_colony", 0, "minecraft:brown_mushroom");
        check(FdRules.colonyRefusal(grown) == null && FdRules.colonyRefusal(young).contains("grow"), "only a grown colony is cut");
        check(FdRules.colonyRefusal(FdRules.colony("", 0, "")).contains("Not a"), "a missing colony is refused");
        Expected cut = FdRules.colonyHarvest(grown);
        check(cut.gainedItems().equals(Set.of("minecraft:brown_mushroom")) && cut.properties().equals(Set.of("age")) && cut.heldDamageAllowed() && cut.maxConsumed() == 1 && !cut.removesBlock(),
            "one mushroom drops, the colony stays, the shears wear");
        check(FdRules.colonyHarvested(grown, FdRules.colony("farmersdelight:brown_mushroom_colony", 2, "minecraft:brown_mushroom")) && !FdRules.colonyHarvested(grown, grown), "one age less");
    }
}
