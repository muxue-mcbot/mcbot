package com.mcbot.servercontrol;

import net.minecraft.resources.ResourceLocation;

/** A recipe with its id, the same on every game version (1.21 wraps them in RecipeHolder, 1.20.1 asks the recipe). */
record IdRecipe<T>(ResourceLocation id, T value) {}
