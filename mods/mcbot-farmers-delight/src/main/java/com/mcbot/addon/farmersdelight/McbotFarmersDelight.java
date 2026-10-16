package com.mcbot.addon.farmersdelight;

import com.mcbot.servercontrol.api.McbotApi;
import net.neoforged.fml.common.Mod;

/**
 * MCBOT add-on for Farmer's Delight. Registers the cutting board, feast, pie, stove, skillet and mushroom colony
 * interactions, cabinets and the basket as storage, the cooking pot and the tomato crop rule;
 * they report themselves as installed only when Farmer's Delight 1.2.9 is present, so the add-on is harmless on servers
 * without it.
 */
@Mod("mcbot_farmers_delight")
public final class McbotFarmersDelight {
    /** Usage note for the agent, sent in hello.hints while the add-on is installed (what FarmersDelightRulesTest covers). */
    static final String HINT = "Farmer's Delight, interact-block: cutting_board/place holding the ingredient, cutting_board/cut holding "
        + "a tool its summary lists, cutting_board/take: empty hand; feast/serve holding the summary's container; "
        + "pie/slice with a knife; stove/add puts one raw food on a lit stove (stove/light: flint and steel); skillet/add "
        + "puts the held stack in a heated skillet (skillet/take: empty hand); mushroom_colony/harvest with shears. Cut or "
        + "cooked food drops: pick it up (cooked after summary.readyInSeconds). Cooking pot: produce-item with the meal loads "
        + "it and leaves; call again later to take the meals.";

    public McbotFarmersDelight() {
        FdInteractions.all().forEach(McbotApi::registerInteraction);
        McbotApi.registerContainer(FdContainers.CABINET);
        McbotApi.registerContainer(FdContainers.BASKET);
        McbotApi.registerWorkstation(CookingPotStation.INSTANCE);
        McbotApi.registerCropRule(TomatoRule.INSTANCE);
        McbotApi.registerHint("farmersdelight:hint", HINT);
    }
}
