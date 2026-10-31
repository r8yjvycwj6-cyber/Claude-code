package com.horrorentities.client;

import com.horrorentities.HorrorEntities;
import com.horrorentities.client.render.HorrorModel;
import com.horrorentities.client.render.HorrorRenderer;
import com.horrorentities.entity.GauntEntity;
import com.horrorentities.entity.HollowEntity;
import com.horrorentities.entity.MimicEntity;
import com.horrorentities.entity.ShadeEntity;
import com.horrorentities.entity.StalkerEntity;
import com.horrorentities.registry.ModItems;

import net.fabricmc.api.ClientModInitializer;
import net.legacyfabric.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.minecraft.client.render.item.ItemModels;
import net.minecraft.client.util.ModelIdentifier;
import net.minecraft.item.Item;

public class HorrorEntitiesClient implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		EntityRendererRegistry.INSTANCE.register(StalkerEntity.class,
				(manager, ctx) -> new HorrorRenderer<StalkerEntity>(manager, new HorrorModel(2, 18, 12), "stalker", 1.35F, 0.4F));
		EntityRendererRegistry.INSTANCE.register(HollowEntity.class,
				(manager, ctx) -> new HorrorRenderer<HollowEntity>(manager, HorrorModel.standard(), "hollow", 1.0F, 0.5F));
		EntityRendererRegistry.INSTANCE.register(MimicEntity.class,
				(manager, ctx) -> new HorrorRenderer<MimicEntity>(manager, HorrorModel.standard(), "mimic", 1.0F, 0.5F));
		EntityRendererRegistry.INSTANCE.register(GauntEntity.class,
				(manager, ctx) -> new HorrorRenderer<GauntEntity>(manager, new HorrorModel(2, 20, 14), "gaunt", 1.0F, 0.4F));
		EntityRendererRegistry.INSTANCE.register(ShadeEntity.class,
				(manager, ctx) -> new HorrorRenderer<ShadeEntity>(manager, HorrorModel.standard(), "shade", 1.05F, 0.0F));

		HorrorEntities.LOGGER.info("Horror Entities client renderers registered");
	}

	/** Mod items have no automatic model; point each one at assets/horrorentities/models/item/<name>.json. */
	public static void registerItemModels(ItemModels models) {
		bind(models, ModItems.NIGHTMARE_SHARD, "nightmare_shard");
		bind(models, ModItems.WARDING_CHARM, "warding_charm");
		bind(models, ModItems.GREATER_WARDING_CHARM, "greater_warding_charm");
	}

	private static void bind(ItemModels models, Item item, String name) {
		models.putModel(item, 0, new ModelIdentifier(HorrorEntities.MOD_ID + ":" + name, "inventory"));
	}
}
