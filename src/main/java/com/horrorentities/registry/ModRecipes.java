package com.horrorentities.registry;

import net.minecraft.block.Blocks;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.recipe.Ingredient;
import net.minecraft.recipe.RecipeDispatcher;
import net.minecraft.recipe.ShapedRecipeType;
import net.minecraft.recipe.ShapelessRecipeType;
import net.minecraft.util.collection.DefaultedList;

public final class ModRecipes {
	private ModRecipes() {
	}

	public static void register() {
		Ingredient none = Ingredient.field_15680;
		Ingredient glow = Ingredient.method_14245(Items.GLOWSTONE_DUST);
		Ingredient gold = Ingredient.method_14245(Items.GOLD_INGOT);

		// Warding Charm:  . G .
		//                 G I G      (G = glowstone dust, I = gold ingot)
		//                 . G .
		DefaultedList<Ingredient> charm = DefaultedList.ofSize(9, none);
		charm.set(1, glow);
		charm.set(3, glow);
		charm.set(4, gold);
		charm.set(5, glow);
		charm.set(7, glow);
		RecipeDispatcher.register("horrorentities:warding_charm",
				new ShapedRecipeType("horrorentities:charms", 3, 3, charm, new ItemStack(ModItems.WARDING_CHARM)));

		// Greater Warding Charm: a charm plus four nightmare shards.
		DefaultedList<Ingredient> greater = DefaultedList.of();
		greater.add(Ingredient.method_14245(ModItems.WARDING_CHARM));

		for (int i = 0; i < 4; i++) {
			greater.add(Ingredient.method_14245(ModItems.NIGHTMARE_SHARD));
		}

		RecipeDispatcher.register("horrorentities:greater_warding_charm",
				new ShapelessRecipeType("horrorentities:charms", new ItemStack(ModItems.GREATER_WARDING_CHARM), greater));
	}
}
