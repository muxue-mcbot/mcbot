package com.mcbot.addon.farmersdelight;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mcbot.servercontrol.api.CropRule;
import com.mcbot.servercontrol.api.ItemInteraction.Expected;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The Farmer's Delight rules as verified against 1.2.9 (CuttingBoardBlock#useItemOn, CuttingBoardBlockEntity,
 * FeastBlock#takeServing, PieBlock#cutSlice, TomatoVineBlock), on plain summaries so they can be checked without a
 * running game. MCBOT compares the whole summary before and after each right-click; every field that may change is
 * named in the envelope.
 */
final class FdRules {
    private FdRules() {}

    // ---------- cutting board: item, carving, tools, results ----------

    static final Set<String> BOARD_FIELDS = Set.of("item", "carving", "tools", "results");

    static JsonObject board(String item, boolean carving, List<String> tools, List<String> results) {
        JsonObject o = new JsonObject();
        o.addProperty("item", item);
        o.addProperty("carving", carving);
        o.add("tools", array(tools));
        o.add("results", array(results));
        return o;
    }

    private static String item(JsonObject s) { return s.get("item").getAsString(); }
    private static boolean carving(JsonObject s) { return s.get("carving").getAsBoolean(); }
    private static Set<String> strings(JsonObject s, String key) {
        Set<String> out = new HashSet<>();
        s.getAsJsonArray(key).forEach(e -> out.add(e.getAsString()));
        return out;
    }

    static String placeRefusal(JsonObject s, boolean heldCuttable, boolean offhandTakesOver) {
        if (!item(s).isEmpty()) return "The board already holds " + item(s) + "; cut it or take it first";
        if (!heldCuttable) return "Nothing is cut from the held item on a cutting board";
        if (offhandTakesOver) return "The off hand holds something that is not equipment; the board would take that instead, so empty the off hand first";
        return null;
    }

    static String cutRefusal(JsonObject s, boolean heldFits) {
        if (item(s).isEmpty()) return "The board is empty; place an ingredient first";
        if (carving(s)) return "The board shows a tool (" + item(s) + "), nothing to cut; take it first";
        if (strings(s, "tools").isEmpty()) return "No cutting recipe takes " + item(s) + "; take it back";
        if (!heldFits) return "Cut " + item(s) + " holding one of " + String.join(", ", strings(s, "tools").stream().sorted().toList());
        return null;
    }

    static String takeRefusal(JsonObject s) {
        return item(s).isEmpty() ? "The board is empty" : null;
    }

    /** One item leaves the hand and lies on the board. */
    static final Expected PLACE = new Expected(1, 1, false, Set.of(), BOARD_FIELDS, Set.of(), false);

    /** The tool takes damage (and may break); the results drop beside the board. */
    static Expected cut(JsonObject before) {
        return new Expected(0, 1, true, Set.of(), BOARD_FIELDS, strings(before, "results"), false);
    }

    /** The item comes back into the inventory (dropped when it is full). */
    static Expected take(JsonObject before) {
        return new Expected(0, 0, false, Set.of(), BOARD_FIELDS, item(before).isEmpty() ? Set.of() : Set.of(item(before)), false);
    }

    static boolean placed(JsonObject before, JsonObject after) { return item(before).isEmpty() && !item(after).isEmpty(); }
    static boolean emptied(JsonObject before, JsonObject after) { return !item(before).isEmpty() && item(after).isEmpty(); }

    // ---------- feasts: feast, servings, serving, container, leftovers ----------

    static final Set<String> FEAST_FIELDS = Set.of("feast", "servings", "serving", "container", "leftovers");

    static JsonObject feast(String feast, int servings, String serving, String container, boolean leftovers) {
        JsonObject o = new JsonObject();
        o.addProperty("feast", feast);
        o.addProperty("servings", servings);
        o.addProperty("serving", serving);
        o.addProperty("container", container);
        o.addProperty("leftovers", leftovers);
        return o;
    }

    private static int servings(JsonObject s) { return s.get("servings").getAsInt(); }
    private static String container(JsonObject s) { return s.get("container").getAsString(); }

    static String serveRefusal(JsonObject s, String heldId) {
        if (s.get("feast").getAsString().isEmpty()) return "Not a Farmer's Delight feast";
        if (servings(s) <= 0) return "Only leftovers are left; nothing to serve";
        if (!container(s).isEmpty() && !container(s).equals(heldId)) return "Serve it holding " + container(s);
        return null;
    }

    /** One container (if the serving needs one) for one serving; the last serving removes a feast without leftovers. */
    static Expected serve(JsonObject before) {
        int used = container(before).isEmpty() ? 0 : 1;
        boolean last = servings(before) == 1 && !before.get("leftovers").getAsBoolean();
        return new Expected(used, used, false, Set.of("servings"), FEAST_FIELDS, Set.of(before.get("serving").getAsString()), false, Set.of(), last);
    }

    static boolean served(JsonObject before, JsonObject after) {
        int b = servings(before);
        if (after.get("feast").getAsString().isEmpty()) return b == 1 && !before.get("leftovers").getAsBoolean();
        return servings(after) == b - 1;
    }

    // ---------- pies: pie, bites, maxBites, slice ----------

    static final Set<String> PIE_FIELDS = Set.of("pie", "bites", "maxBites", "slice");

    static JsonObject pie(String pie, int bites, int maxBites, String slice) {
        JsonObject o = new JsonObject();
        o.addProperty("pie", pie);
        o.addProperty("bites", bites);
        o.addProperty("maxBites", maxBites);
        o.addProperty("slice", slice);
        return o;
    }

    static String sliceRefusal(JsonObject s, boolean heldKnife) {
        if (s.get("pie").getAsString().isEmpty()) return "Not a Farmer's Delight pie";
        if (!heldKnife) return "Slice it holding a knife";
        return null;
    }

    /** A knife cuts one slice off (it drops); the last slice removes the pie. The knife is not damaged. */
    static Expected slice(JsonObject before) {
        boolean last = before.get("bites").getAsInt() >= before.get("maxBites").getAsInt() - 1;
        return new Expected(0, 0, false, Set.of("bites"), PIE_FIELDS, Set.of(before.get("slice").getAsString()), false, Set.of(), last);
    }

    static boolean sliced(JsonObject before, JsonObject after) {
        int b = before.get("bites").getAsInt();
        if (after.get("pie").getAsString().isEmpty()) return b >= before.get("maxBites").getAsInt() - 1;
        return after.get("bites").getAsInt() == b + 1;
    }

    // ---------- tomatoes ----------

    static final String TOMATOES = "farmersdelight:tomatoes", BUDDING_TOMATOES = "farmersdelight:budding_tomatoes";
    static final String VINE_CLASS = "vectorwing.farmersdelight.common.block.TomatoVineBlock", BUDDING_CLASS = "vectorwing.farmersdelight.common.block.BuddingTomatoBlock";

    /**
     * A tomato vine is picked with a right-click (tomatoes drop, the vine goes back to age 0); breaking it would lose
     * the vine, and its seeds plant a budding tomato, not a vine. A budding tomato turns into a vine by itself.
     */
    static CropRule.Harvest tomato(String blockId, String className) {
        if (TOMATOES.equals(blockId) && VINE_CLASS.equals(className)) return CropRule.Harvest.PICK;
        if (BUDDING_TOMATOES.equals(blockId) && BUDDING_CLASS.equals(className)) return CropRule.Harvest.GROWING;
        return null;
    }

    private static JsonArray array(List<String> values) {
        JsonArray a = new JsonArray();
        values.forEach(a::add);
        return a;
    }
}
