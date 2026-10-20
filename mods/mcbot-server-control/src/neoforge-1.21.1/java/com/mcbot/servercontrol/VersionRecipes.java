package com.mcbot.servercontrol;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.StonecutterMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.*;

/** Version shim for MC 1.21.1: reading recipes and brewing rules (see {@link Version}). */
final class VersionRecipes {
    private VersionRecipes() {}

    /** Every recipe of this type the server has loaded, with its id. */
    @SuppressWarnings({"unchecked", "rawtypes"})
    static <T extends Recipe<?>> List<IdRecipe<T>> all(MinecraftServer server, RecipeType<T> type) {
        List<IdRecipe<T>> recipes = new ArrayList<>();
        for (Object holder : server.getRecipeManager().getAllRecipesFor((RecipeType) type)) {
            RecipeHolder<?> h = (RecipeHolder<?>) holder;
            recipes.add(new IdRecipe<>(h.id(), (T) h.value()));
        }
        return recipes;
    }

    /** The cooking recipe of this type that takes this one input, as the furnace itself would pick it. */
    static <T extends AbstractCookingRecipe> Optional<IdRecipe<T>> cookingFor(ServerPlayer player, RecipeType<T> type, ItemStack input) {
        return player.getServer().getRecipeManager().getRecipeFor(type, new SingleRecipeInput(input), player.level()).map(h -> new IdRecipe<>(h.id(), h.value()));
    }

    /** The recipes a stonecutter menu offers for its current input, in button order. */
    static List<IdRecipe<StonecutterRecipe>> stonecutterOptions(StonecutterMenu menu) {
        List<IdRecipe<StonecutterRecipe>> options = new ArrayList<>();
        for (RecipeHolder<StonecutterRecipe> h : menu.getRecipes()) options.add(new IdRecipe<>(h.id(), h.value()));
        return options;
    }

    /** Whether the server's brewing rules take this stack as a reagent. */
    static boolean brewingIngredient(ServerLevel level, ItemStack stack) { return level.potionBrewing().isIngredient(stack); }

    /** What brewing this reagent into this bottle gives, or EMPTY when the rules have no such mix. */
    static ItemStack brewingMix(ServerLevel level, ItemStack subject, ItemStack ingredient) {
        var brewing = level.potionBrewing();
        if (subject.isEmpty() || !brewing.hasMix(subject, ingredient)) return ItemStack.EMPTY;
        return brewing.mix(ingredient, subject.copy());
    }
}
