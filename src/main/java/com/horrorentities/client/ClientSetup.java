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
	}

	private static void registerRenderers(EntityRenderersEvent.RegisterRenderers event) {
		event.registerEntityRenderer(ModEntities.STALKER.get(), ctx -> new HorrorRenderer<>(ctx, STALKER_LAYER, "stalker", 1.35F, 0.4F));
	}
}
