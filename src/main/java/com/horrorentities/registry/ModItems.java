package com.horrorentities.registry;

import com.horrorentities.HorrorEntities;
import com.horrorentities.item.WardingCharmItem;

import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.common.ForgeSpawnEggItem;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

import java.util.function.Supplier;

public final class ModItems {
	public static final DeferredRegister<Item> ITEMS = DeferredRegister.create(ForgeRegistries.ITEMS, HorrorEntities.MOD_ID);
	public static final DeferredRegister<CreativeModeTab> TABS = DeferredRegister.create(Registries.CREATIVE_MODE_TAB, HorrorEntities.MOD_ID);

	public static final RegistryObject<Item> NIGHTMARE_SHARD = ITEMS.register("nightmare_shard", () -> new Item(new Item.Properties()));
	public static final RegistryObject<Item> WARDING_CHARM = ITEMS.register("warding_charm",
			() -> new WardingCharmItem(new Item.Properties().durability(80)));
	public static final RegistryObject<Item> GREATER_WARDING_CHARM = ITEMS.register("greater_warding_charm",
			() -> new WardingCharmItem(new Item.Properties().durability(400)));

	public static final RegistryObject<Item> STALKER_SPAWN_EGG = egg("stalker", ModEntities.STALKER, 0x0b0b0f, 0xd9d9d9);
	public static final RegistryObject<Item> HOLLOW_SPAWN_EGG = egg("hollow", ModEntities.HOLLOW, 0x3a6ea5, 0xffffff);
	public static final RegistryObject<Item> MIMIC_SPAWN_EGG = egg("mimic", ModEntities.MIMIC, 0x6b6a4a, 0xb22222);
	public static final RegistryObject<Item> GAUNT_SPAWN_EGG = egg("gaunt", ModEntities.GAUNT, 0x4d4d4d, 0xe8e0a0);
	public static final RegistryObject<Item> SHADE_SPAWN_EGG = egg("shade", ModEntities.SHADE, 0x000000, 0x5b2a86);

	public static final RegistryObject<CreativeModeTab> MAIN_TAB = TABS.register("main", () -> CreativeModeTab.builder()
			.title(Component.translatable("itemGroup." + HorrorEntities.MOD_ID + ".main"))
			.icon(() -> new ItemStack(WARDING_CHARM.get()))
			.displayItems((parameters, output) -> {
				output.accept(NIGHTMARE_SHARD.get());
				output.accept(WARDING_CHARM.get());
				output.accept(GREATER_WARDING_CHARM.get());
				output.accept(STALKER_SPAWN_EGG.get());
				output.accept(HOLLOW_SPAWN_EGG.get());
				output.accept(MIMIC_SPAWN_EGG.get());
				output.accept(GAUNT_SPAWN_EGG.get());
				output.accept(SHADE_SPAWN_EGG.get());
			})
			.build());

	private ModItems() {
	}

	private static RegistryObject<Item> egg(String name, Supplier<? extends EntityType<? extends Mob>> type, int primary, int secondary) {
		return ITEMS.register(name + "_spawn_egg", () -> new ForgeSpawnEggItem(type, primary, secondary, new Item.Properties()));
	}
}
