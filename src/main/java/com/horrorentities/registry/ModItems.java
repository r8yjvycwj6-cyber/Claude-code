package com.horrorentities.registry;

import com.horrorentities.HorrorEntities;
import com.horrorentities.item.WardingCharmItem;

import net.legacyfabric.fabric.api.client.itemgroup.FabricItemGroupBuilder;
import net.legacyfabric.fabric.api.registry.v2.RegistryHelper;
import net.legacyfabric.fabric.api.registry.v2.RegistryIds;
import net.legacyfabric.fabric.api.util.Identifier;
import net.minecraft.item.Item;
import net.minecraft.item.itemgroup.ItemGroup;

public final class ModItems {
	public static Item NIGHTMARE_SHARD;
	public static Item WARDING_CHARM;
	public static Item GREATER_WARDING_CHARM;
	public static ItemGroup GROUP;

	private ModItems() {
	}

	public static void register() {
		GROUP = FabricItemGroupBuilder.create(id("main"))
				.iconWithItem(() -> WARDING_CHARM)
				.build();

		NIGHTMARE_SHARD = add("nightmare_shard", new Item());
		WARDING_CHARM = add("warding_charm", new WardingCharmItem(80));
		GREATER_WARDING_CHARM = add("greater_warding_charm", new WardingCharmItem(400));
	}

	private static Item add(String name, Item item) {
		item.setTranslationKey(HorrorEntities.MOD_ID + "." + name);
		item.setItemGroup(GROUP);
		RegistryHelper.register(RegistryIds.ITEMS, id(name), item);
		return item;
	}

	public static Identifier id(String path) {
		return new Identifier(HorrorEntities.MOD_ID, path);
	}
}
