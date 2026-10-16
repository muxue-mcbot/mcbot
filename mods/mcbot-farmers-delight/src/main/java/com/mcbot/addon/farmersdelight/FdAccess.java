package com.mcbot.addon.farmersdelight;

import com.google.gson.JsonObject;
import com.mcbot.servercontrol.api.McbotApi;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.tags.TagKey;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.level.block.state.properties.Property;

/**
 * Read-only reflective view of the Farmer's Delight blocks the add-on knows. Every class, method and tag name below was
 * checked against Farmer's Delight 1.2.9 (NeoForge 1.21.1); when one is missing the add-on reports itself as not
 * installed rather than guessing. Nothing here changes the world: the bot only ever acts through the player's own
 * right-click, which MCBOT sends and checks.
 */
final class FdAccess {
    private FdAccess() {}
    static final String MOD = "farmersdelight", VERSION = "1.2.9";
    private static final String BLOCKS = "vectorwing.farmersdelight.common.block.";
    static final String CUTTING_BOARD_ID = "farmersdelight:cutting_board", CUTTING_BOARD_CLASS = BLOCKS + "CuttingBoardBlock",
        CUTTING_BOARD_ENTITY = BLOCKS + "entity.CuttingBoardBlockEntity", CUTTING_RECIPE = "vectorwing.farmersdelight.common.crafting.CuttingBoardRecipe";
    static final String FEAST_CLASS = BLOCKS + "FeastBlock", PIE_CLASS = BLOCKS + "PieBlock";
    static final TagKey<Item> KNIVES = itemTag("tools/knives"), OFFHAND_EQUIPMENT = itemTag("offhand_equipment");
    private static final ResourceLocation CUTTING = ResourceLocation.fromNamespaceAndPath(MOD, "cutting");

    private static TagKey<Item> itemTag(String path) { return TagKey.create(Registries.ITEM, ResourceLocation.fromNamespaceAndPath(MOD, path)); }

    private static volatile boolean broken;

    static boolean installed() { return McbotApi.versionsMatch(MOD, VERSION) && !broken; }

    /** A name checked against 1.2.9 is gone: stop claiming support until the server restarts with the right version. */
    static RuntimeException changed(String what, Throwable cause) {
        broken = true;
        return new IllegalStateException("Farmer's Delight changed (" + what + "); add-on disabled", cause);
    }

    static String id(Block block) { return BuiltInRegistries.BLOCK.getKey(block).toString(); }
    static String id(Item item) { return BuiltInRegistries.ITEM.getKey(item).toString(); }
    static String id(ItemStack stack) { return stack.isEmpty() ? "" : id(stack.getItem()); }

    /** Exactly this block id with exactly this block class. */
    static boolean is(BlockState state, String blockId, String className) {
        return blockId.equals(id(state.getBlock())) && className.equals(state.getBlock().getClass().getName());
    }

    /** A Farmer's Delight block whose class is, or extends, this verified class (feasts and pies have a subclass each). */
    static boolean extendsClass(BlockState state, String className) {
        if (!id(state.getBlock()).startsWith(MOD + ":")) return false;
        for (Class<?> type = state.getBlock().getClass(); type != null; type = type.getSuperclass())
            if (type.getName().equals(className)) return true;
        return false;
    }

    static IntegerProperty intProperty(BlockState state, String name) {
        for (Property<?> property : state.getProperties())
            if (property instanceof IntegerProperty p && p.getName().equals(name)) return p;
        throw changed("block property " + name, null);
    }

    static Method method(Class<?> type, String name, Class<?>... parameters) {
        try { return type.getMethod(name, parameters); } catch (NoSuchMethodException missing) { throw changed(type.getSimpleName() + "." + name, missing); }
    }

    static Object call(Method method, Object target, Object... args) {
        try { return method.invoke(target, args); } catch (ReflectiveOperationException failed) { throw changed(method.getName(), failed); }
    }

    // ---------- cutting board ----------

    /** The board's block entity of the verified class, or an exception. */
    static BlockEntity board(ServerLevel level, BlockPos position) {
        BlockState state = level.getBlockState(position);
        if (!is(state, CUTTING_BOARD_ID, CUTTING_BOARD_CLASS)) throw new IllegalStateException("not a Farmer's Delight cutting board");
        BlockEntity entity = level.getChunkAt(position).getBlockEntity(position);
        if (entity == null || !CUTTING_BOARD_ENTITY.equals(entity.getClass().getName())) throw new IllegalStateException("cutting board block entity missing or changed");
        return entity;
    }

    static ItemStack stored(BlockEntity board) { return (ItemStack) call(method(board.getClass(), "getStoredItem"), board); }
    static boolean carving(BlockEntity board) { return (boolean) call(method(board.getClass(), "isItemCarvingBoard"), board); }

    /** One cutting recipe: what goes on the board, the tool, and every item it can give (chance ones included). */
    record Cut(String id, Ingredient input, Ingredient tool, List<ItemStack> results) {}

    /** The server's cutting recipes, read live (data packs can change them). */
    @SuppressWarnings({"unchecked", "rawtypes"})
    static List<Cut> cuts(Level level) {
        RecipeType<?> type = BuiltInRegistries.RECIPE_TYPE.get(CUTTING);
        if (type == null) throw changed("recipe type " + CUTTING, null);
        List<Cut> cuts = new ArrayList<>();
        for (RecipeHolder<?> holder : (List<RecipeHolder<?>>) (List) level.getRecipeManager().getAllRecipesFor((RecipeType) type)) {
            Object recipe = holder.value();
            if (!CUTTING_RECIPE.equals(recipe.getClass().getName())) continue;
            List<Ingredient> inputs = holder.value().getIngredients();
            if (inputs.isEmpty()) continue;
            Ingredient tool = (Ingredient) call(method(recipe.getClass(), "getTool"), recipe);
            List<ItemStack> results = (List<ItemStack>) call(method(recipe.getClass(), "getResults"), recipe);
            cuts.add(new Cut(holder.id().toString(), inputs.getFirst(), tool, List.copyOf(results)));
        }
        return cuts;
    }

    static List<Cut> cutsFor(Level level, ItemStack input) {
        return input.isEmpty() ? List.of() : cuts(level).stream().filter(c -> c.input().test(input)).toList();
    }

    /** Board summary: the item on it, whether it shows a tool (carving), and the tools and results of its recipes. */
    static JsonObject boardSummary(ServerLevel level, BlockPos position) {
        BlockEntity board = board(level, position);
        ItemStack stored = stored(board);
        Set<String> tools = new LinkedHashSet<>(), results = new LinkedHashSet<>();
        for (Cut cut : cutsFor(level, stored)) {
            for (ItemStack tool : cut.tool().getItems()) tools.add(id(tool));
            for (ItemStack result : cut.results()) results.add(id(result));
        }
        return FdRules.board(id(stored), carving(board), List.copyOf(tools), List.copyOf(results));
    }

    /** Whether the held stack can go on the board and be cut there (it is the input of a cutting recipe). */
    static boolean cuttable(Level level, ItemStack held) { return !held.isEmpty() && !cutsFor(level, held).isEmpty(); }

    /** Whether the held stack is the tool of a recipe for what lies on the board. */
    static boolean fitsBoard(Level level, ItemStack stored, ItemStack held) {
        return !held.isEmpty() && cutsFor(level, stored).stream().anyMatch(c -> c.tool().test(held));
    }

    /**
     * The board passes a click on to the off hand when the off hand holds something that is not equipment (a shield)
     * and the main hand holds no block; MCBOT only clicks with the main hand, so nothing would happen.
     */
    static boolean offhandTakesOver(ServerPlayer player, ItemStack held) {
        ItemStack offhand = player.getOffhandItem();
        return !offhand.isEmpty() && !offhand.is(OFFHAND_EQUIPMENT) && !(held.getItem() instanceof BlockItem);
    }

    // ---------- feasts and pies ----------

    /** Feast summary; a block that is gone (the last serving taken) reads as an empty feast. */
    static JsonObject feastSummary(ServerLevel level, BlockPos position) {
        BlockState state = level.getBlockState(position);
        if (!extendsClass(state, FEAST_CLASS)) return FdRules.feast("", 0, "", "", false);
        Block block = state.getBlock();
        IntegerProperty servings = (IntegerProperty) call(method(block.getClass(), "getServingsProperty"), block);
        ItemStack serving = (ItemStack) call(method(block.getClass(), "getServingItem", BlockState.class), block, state);
        boolean leftovers;
        try { leftovers = block.getClass().getField("hasLeftovers").getBoolean(block); } catch (ReflectiveOperationException missing) { throw changed("FeastBlock.hasLeftovers", missing); }
        String container = serving.hasCraftingRemainingItem() ? id(serving.getCraftingRemainingItem()) : "";
        return FdRules.feast(id(block), state.getValue(servings), id(serving), container, leftovers);
    }

    /** Pie summary; a pie that is gone (the last slice cut) reads as an empty pie. */
    static JsonObject pieSummary(ServerLevel level, BlockPos position) {
        BlockState state = level.getBlockState(position);
        if (!extendsClass(state, PIE_CLASS)) return FdRules.pie("", 0, 0, "");
        Block block = state.getBlock();
        int max = (int) call(method(block.getClass(), "getMaxBites"), block);
        ItemStack slice = (ItemStack) call(method(block.getClass(), "getPieSliceItem"), block);
        return FdRules.pie(id(block), state.getValue(intProperty(state, "bites")), max, id(slice));
    }
}
