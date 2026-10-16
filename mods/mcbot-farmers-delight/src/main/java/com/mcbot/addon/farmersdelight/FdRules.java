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

    // ---------- stove: lit ----------

    /**
     * Only lighting is offered: food grilled on top of a stove pops out onto the stove, and MCBOT's walking keeps off
     * the cells next to a lit stove, so the bot could not pick it up again. A lit stove heats a pot or a skillet on it.
     */
    static final Set<String> STOVE_FIELDS = Set.of("lit");

    static JsonObject stove(boolean lit) {
        JsonObject o = new JsonObject();
        o.addProperty("lit", lit);
        return o;
    }

    static String lightRefusal(JsonObject s) {
        return s.get("lit").getAsBoolean() ? "The stove is already lit" : null;
    }

    /** Flint and steel wears (and may break); a fire charge is used up. */
    static final Expected STOVE_LIGHT = new Expected(0, 1, true, Set.of("lit"), STOVE_FIELDS, Set.of(), false);

    static boolean lit(JsonObject before, JsonObject after) {
        return !before.get("lit").getAsBoolean() && after.get("lit").getAsBoolean();
    }

    /**
     * Whole seconds for the ticks still to go, rounded up; -1 when nothing will cook (no heat). Food in a skillet cooks
     * by itself once it is in, so this is when the last piece pops out.
     */
    static int seconds(int ticks, boolean heated) {
        if (ticks <= 0) return 0;
        return heated ? (ticks + 19) / 20 : -1;
    }

    // ---------- skillet: item, count, heated, waterlogged, readyInSeconds ----------

    static final Set<String> SKILLET_FIELDS = Set.of("item", "count", "heated", "waterlogged", "readyInSeconds");

    /** cookTime counts up to cookTimeTotal for the piece being cooked; the rest of the stack follows one by one. */
    static JsonObject skillet(String item, int count, boolean heated, boolean waterlogged, int cookTime, int cookTimeTotal) {
        JsonObject o = new JsonObject();
        o.addProperty("item", item);
        o.addProperty("count", item.isEmpty() ? 0 : count);
        o.addProperty("heated", heated);
        o.addProperty("waterlogged", waterlogged);
        int ticks = item.isEmpty() ? 0 : Math.max(0, cookTimeTotal - cookTime) + (count - 1) * Math.max(0, cookTimeTotal);
        o.addProperty("readyInSeconds", seconds(ticks, heated));
        return o;
    }

    /** SkilletBlockEntity#addItemToCook takes the whole held stack into an empty, dry skillet when it has a campfire recipe. */
    static String skilletAddRefusal(JsonObject s, boolean heldCooks) {
        if (!heldCooks) return "The held item does not cook in a skillet (it has no campfire recipe)";
        if (s.get("waterlogged").getAsBoolean()) return "The skillet is under water";
        if (!item(s).isEmpty()) return "The skillet already holds " + item(s) + "; wait for it to cook or take it (skillet/take)";
        if (!s.get("heated").getAsBoolean()) return "No heat under the skillet (a lit stove or campfire, fire, magma or lava below)";
        return null;
    }

    /** The whole held stack goes in. */
    static final Expected SKILLET_ADD = new Expected(1, 64, false, Set.of(), SKILLET_FIELDS, Set.of(), false);

    static boolean skilletLoaded(JsonObject before, JsonObject after) {
        return item(before).isEmpty() && !item(after).isEmpty() && after.get("count").getAsInt() > 0;
    }

    static String skilletTakeRefusal(JsonObject s) {
        return item(s).isEmpty() ? "The skillet is empty" : null;
    }

    /** What is still in the skillet comes back into the empty hand. */
    static Expected skilletTake(JsonObject before) {
        return new Expected(0, 0, false, Set.of(), SKILLET_FIELDS, item(before).isEmpty() ? Set.of() : Set.of(item(before)), false);
    }

    static boolean skilletEmptied(JsonObject before, JsonObject after) { return !item(before).isEmpty() && item(after).isEmpty(); }

    // ---------- mushroom colonies: colony, age, mushroom ----------

    static final Set<String> COLONY_FIELDS = Set.of("colony", "age", "mushroom");

    static JsonObject colony(String colony, int age, String mushroom) {
        JsonObject o = new JsonObject();
        o.addProperty("colony", colony);
        o.addProperty("age", age);
        o.addProperty("mushroom", mushroom);
        return o;
    }

    private static int age(JsonObject s) { return s.get("age").getAsInt(); }

    /** MushroomColonyBlock#useItemOn: shears cut one mushroom off (it drops) while the colony has grown at least once. */
    static String colonyRefusal(JsonObject s) {
        if (s.get("colony").getAsString().isEmpty()) return "Not a Farmer's Delight mushroom colony";
        if (age(s) <= 0) return "Nothing to cut yet; the colony has to grow first";
        return null;
    }

    /** One mushroom drops, the colony shrinks by one; the shears wear and may break. */
    static Expected colonyHarvest(JsonObject before) {
        return new Expected(0, 1, true, Set.of("age"), COLONY_FIELDS, Set.of(before.get("mushroom").getAsString()), false);
    }

    static boolean colonyHarvested(JsonObject before, JsonObject after) {
        return age(after) == age(before) - 1 && after.get("colony").equals(before.get("colony"));
    }

    // ---------- cooking pot ----------

    /** Inventory slot behind a player slot of CookingPotMenu: menu 9-35 are the main rows (same index), 36-44 the hotbar. */
    static int playerSlot(int menuSlot) { return menuSlot < 36 ? menuSlot : menuSlot - 36; }

    /** The pot's own nine menu slots: the verified classes, all on the pot's one item handler, in its slot order. */
    static boolean potSlots(List<String> classes, List<String> expected, List<Object> handlers, Object inventory, List<Integer> indices) {
        if (inventory == null || !classes.equals(expected) || handlers.size() != expected.size() || indices.size() != expected.size()) return false;
        for (int i = 0; i < expected.size(); i++) if (handlers.get(i) != inventory || indices.get(i) != i) return false;
        return true;
    }

    /**
     * Ticks until the inputs are used up: the rest of the current meal plus a full cook for every set still in.
     * -1 when it is not cooking or the pot has no cook time yet; 0 when nothing is left.
     */
    static int potTicksLeft(int sets, int cookTime, int cookTimeTotal, boolean working) {
        if (sets <= 0) return 0;
        if (!working || cookTimeTotal <= 0) return -1;
        return Math.max(0, cookTimeTotal - cookTime) + (sets - 1) * cookTimeTotal;
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
