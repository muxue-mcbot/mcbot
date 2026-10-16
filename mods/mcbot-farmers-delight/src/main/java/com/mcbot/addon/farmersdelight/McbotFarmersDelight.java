package com.mcbot.addon.farmersdelight;

import com.mcbot.servercontrol.api.McbotApi;
import net.neoforged.fml.common.Mod;

/**
 * MCBOT add-on for Farmer's Delight. Registers the cutting board, feast and pie interactions and the tomato crop rule;
 * they report themselves as installed only when Farmer's Delight 1.2.9 is present, so the add-on is harmless on servers
 * without it.
 */
@Mod("mcbot_farmers_delight")
public final class McbotFarmersDelight {
    /** Usage note for the agent, sent in hello.hints while the add-on is installed (what FarmersDelightRulesTest covers). */
    static final String HINT = "Farmer's Delight, with interact-block: cutting board: cutting_board/place holding the ingredient (one item goes on), "
        + "cutting_board/cut holding the tool its summary lists (usually a knife; results drop beside the board, pick them up), "
        + "cutting_board/take with an empty hand. Feasts: feast/serve holding the container the summary names (usually a bowl). "
        + "Pies: pie/slice holding a knife (the slice drops). tend-crops picks ripe tomatoes without breaking the vines.";

    public McbotFarmersDelight() {
        FdInteractions.all().forEach(McbotApi::registerInteraction);
        McbotApi.registerCropRule(TomatoRule.INSTANCE);
        McbotApi.registerHint("farmersdelight:hint", HINT);
    }
}
