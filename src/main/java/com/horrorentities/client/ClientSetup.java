package com.horrorentities.client;

import com.horrorentities.HorrorEntities;
import com.horrorentities.registry.ModEntities;

import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.resources.ResourceLocation;
import net.minecraftforge.client.event.EntityRenderersEvent;
import net.minecraftforge.eventbus.api.IEventBus;

/** Client-only registration: model layers and entity renderers. */
public final class ClientSetup {
	public static final ModelLayerLocation STALKER_LAYER = layer("stalker");
	public static final ModelLayerLocation HOLLOW_LAYER = layer("hollow");
	public static final ModelLayerLocation MIMIC_LAYER = layer("mimic");
	public static final ModelLayerLocation GAUNT_LAYER = layer("gaunt");
	public static final ModelLayerLocation SHADE_LAYER = layer("shade");

	private ClientSetup() {
	}

	private static ModelLayerLocation layer(String name) {
		return new ModelLayerLocation(ResourceLocation.fromNamespaceAndPath(HorrorEntities.MOD_ID, name), "main");
	}

	public static void register(IEventBus modBus) {
		modBus.addListener(ClientSetup::registerLayers);
		modBus.addListener(ClientSetup::registerRenderers);
	}

	private static void registerLayers(EntityRenderersEvent.RegisterLayerDefinitions event) {
		event.registerLayerDefinition(STALKER_LAYER, () -> HorrorModel.createBodyLayer(2, 18, 12));
		event.registerLayerDefinition(HOLLOW_LAYER, () -> HorrorModel.createBodyLayer(4, 12, 12));
		event.registerLayerDefinition(MIMIC_LAYER, () -> HorrorModel.createBodyLayer(4, 12, 12));
		event.registerLayerDefinition(GAUNT_LAYER, () -> HorrorModel.createBodyLayer(2, 20, 14));
		event.registerLayerDefinition(SHADE_LAYER, () -> HorrorModel.createBodyLayer(4, 12, 12));
	}

	private static void registerRenderers(EntityRenderersEvent.RegisterRenderers event) {
		event.registerEntityRenderer(ModEntities.STALKER.get(), ctx -> new HorrorRenderer<>(ctx, STALKER_LAYER, "stalker", 1.35F, 0.4F));
		event.registerEntityRenderer(ModEntities.HOLLOW.get(), ctx -> new HorrorRenderer<>(ctx, HOLLOW_LAYER, "hollow", 1.0F, 0.5F));
		event.registerEntityRenderer(ModEntities.MIMIC.get(), ctx -> new HorrorRenderer<>(ctx, MIMIC_LAYER, "mimic", 1.0F, 0.5F));
		event.registerEntityRenderer(ModEntities.GAUNT.get(), ctx -> new HorrorRenderer<>(ctx, GAUNT_LAYER, "gaunt", 1.0F, 0.4F));
		event.registerEntityRenderer(ModEntities.SHADE.get(), ctx -> new HorrorRenderer<>(ctx, SHADE_LAYER, "shade", 1.05F, 0.0F));
	}
}
