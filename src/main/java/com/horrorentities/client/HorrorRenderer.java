package com.horrorentities.client;

import com.horrorentities.HorrorEntities;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;

import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.HumanoidMobRenderer;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.Mob;

/** One renderer for every horror entity: a humanoid skin, a size multiplier and glowing eyes. */
public class HorrorRenderer<T extends Mob> extends HumanoidMobRenderer<T, HumanoidModel<T>> {
	private final ResourceLocation skin;
	private final float size;

	public HorrorRenderer(EntityRendererProvider.Context context, ModelLayerLocation layer, String name, float size, float shadow) {
		super(context, new HorrorModel<>(context.bakeLayer(layer)), shadow);
		this.skin = ResourceLocation.fromNamespaceAndPath(HorrorEntities.MOD_ID, "textures/entity/" + name + ".png");
		this.size = size;
		this.addLayer(new EyesLayer<>(this,
				ResourceLocation.fromNamespaceAndPath(HorrorEntities.MOD_ID, "textures/entity/" + name + "_eyes.png")));
	}

	@Override
	public ResourceLocation getTextureLocation(T entity) {
		return this.skin;
	}

	@Override
	protected void scale(T entity, PoseStack poseStack, float partialTick) {
		poseStack.scale(this.size, this.size, this.size);
	}

	/** Draws the eye overlay at full brightness regardless of the light level, like an enderman's eyes. */
	private static final class EyesLayer<T extends Mob> extends RenderLayer<T, HumanoidModel<T>> {
		private final RenderType renderType;

		EyesLayer(HorrorRenderer<T> parent, ResourceLocation texture) {
			super(parent);
			this.renderType = RenderType.eyes(texture);
		}

		@Override
		public void render(PoseStack poseStack, MultiBufferSource buffer, int packedLight, T entity, float limbSwing,
				float limbSwingAmount, float partialTick, float ageInTicks, float netHeadYaw, float headPitch) {
			VertexConsumer consumer = buffer.getBuffer(this.renderType);
			this.getParentModel().renderToBuffer(poseStack, consumer, 0xF000F0, OverlayTexture.NO_OVERLAY, -1);
		}
	}
}
