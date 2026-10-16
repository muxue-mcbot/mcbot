package com.mcbot.addon.farmersdelight;

import com.mcbot.servercontrol.api.McbotApi;
import net.neoforged.fml.common.Mod;

/**
 * MCBOT add-on for Farmer's Delight. Registers the cutting board, feast and pie interactions, the cooking pot and the
 * tomato crop rule;
 * they report themselves as installed only when Farmer's Delight 1.2.9 is present, so the add-on is harmless on servers
 * without it.
 */
@Mod("mcbot_farmers_delight")
public final class McbotFarmersDelight {
    /** Usage note for the agent, sent in hello.hints while the add-on is installed (what FarmersDelightRulesTest covers). */
    static final String HINT = "Farmer's Delight, interact-block: cutting_board/place holding the ingredient (one goes on), "
        + "cutting_board/cut holding a tool its summary lists (results drop beside the board, pick them up), cutting_board/take "
        + "with an empty hand; feast/serve holding the container the summary names (usually a bowl); pie/slice holding a knife "
        + "(the slice drops). Cooking pot (needs heat below): produce-item with the meal puts inputs and bowls in and leaves; "
        + "call it again later to take the meals out. tend-crops picks ripe tomatoes without breaking vines.";

    public McbotFarmersDelight() {
        FdInteractions.all().forEach(McbotApi::registerInteraction);
        McbotApi.registerWorkstation(CookingPotStation.INSTANCE);
        McbotApi.registerCropRule(TomatoRule.INSTANCE);
        McbotApi.registerHint("farmersdelight:hint", HINT);
    }
}
