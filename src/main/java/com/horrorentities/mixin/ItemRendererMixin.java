package com.horrorentities.mixin;

import com.horrorentities.client.HorrorEntitiesClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import net.minecraft.client.render.item.ItemRenderer;

/**
 * 1.12.2 never registers models for modded items on its own. The item renderer fills its model
 * table in initModels(); we add ours right after the vanilla entries.
 */
@Mixin(ItemRenderer.class)
public abstract class ItemRendererMixin {
	@Inject(method = "initModels", at = @At("TAIL"))
	private void horrorentities$registerItemModels(CallbackInfo ci) {
		HorrorEntitiesClient.registerItemModels(((ItemRenderer) (Object) this).getModels());
	}
}
