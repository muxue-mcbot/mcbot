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
        System.out.println("FarmersDelightRulesTest: " + checks + " checks passed (cutting board, feasts, pies, tomatoes; no Minecraft launch)");
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
}
