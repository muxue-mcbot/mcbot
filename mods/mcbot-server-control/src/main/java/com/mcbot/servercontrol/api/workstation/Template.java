package com.mcbot.servercontrol.api.workstation;

/**
 * How the core drives a workstation. Adapters pick one; the core does all walking, clicking, waiting and checking.
 * OPTION_PICKER, IN_PLACE and MODIFIER are used by the built-in vanilla stations only; produce-item and
 * modify-item do not pick an add-on station registered with them yet.
 */
public enum Template {
    /**
     * A crafting grid: ingredients go into {@link Port#INGREDIENT} cells laid out row-major in
     * {@link StationLayout#gridWidth()} x {@link StationLayout#gridHeight()}, the station shows the result in
     * {@link Port#RESULT}, taking it commits the craft. Recipes come from {@link RecipeSource#producing}.
     */
    GRID_CRAFTER,
    /**
     * A machine that works by itself once loaded: {@link Port#INGREDIENT} inputs, an optional {@link Port#FUEL} slot
     * and a {@link Port#RESULT}. With one input (a furnace) smelt-item drives it, the recipe for an input coming from
     * {@link RecipeSource#forInput}. With several (a cooking pot) produce-item drives it: the recipe for the wanted item
     * comes from {@link RecipeSource#producing} ({@link StationRecipe#shapeless}), each input goes into an ingredient
     * slot of its own, the recipe's container into the optional {@link Port#CONTAINER} slot, and work in progress may
     * show in a {@link Port#BUFFER} slot. The body may wait beside it and take results as they come, or leave and
     * collect later.
     */
    PROCESSOR,
    /**
     * One input, the result chosen with a menu button among {@link WorkstationAdapter#options}, taken from
     * {@link Port#RESULT} (stonecutter). Taking it commits.
     */
    OPTION_PICKER,
    /**
     * Machines that change {@link Port#SUBJECT} items where they stand once an {@link Port#INGREDIENT} and fuel are in
     * (brewing stand). Recipes come from {@link RecipeSource#transform}; the body waits beside it for each stage.
     */
    IN_PLACE,
    /**
     * Work on one chosen item ({@link Port#SUBJECT}) with optional {@link Port#CATALYST} inputs, an optional option
     * button and a level cost ({@link WorkstationAdapter#levelCost}): enchanting table, anvil, grindstone, smithing
     * table, loom, cartography table. Previewed first; only an explicitly referenced item is ever put in.
     */
    MODIFIER
}
