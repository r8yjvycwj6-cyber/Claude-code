package com.horrorentities.client.render;

import com.horrorentities.HorrorEntities;
import com.mojang.blaze3d.platform.GLX;
import com.mojang.blaze3d.platform.GlStateManager;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.entity.BipedEntityRenderer;
import net.minecraft.client.render.entity.EntityRenderDispatcher;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.util.Identifier;

/** One renderer for every horror entity: a biped skin, a size multiplier and glowing eyes. */
public class HorrorRenderer<T extends MobEntity> extends BipedEntityRenderer<T> {
	private final Identifier skin;
	private final float size;

	public HorrorRenderer(EntityRenderDispatcher dispatcher, HorrorModel model, String name, float size, float shadow) {
		super(dispatcher, model, shadow);
		this.skin = new Identifier(HorrorEntities.MOD_ID, "textures/entity/" + name + ".png");
		this.size = size;
		this.addFeature(new EyesFeature<T>(this, new Identifier(HorrorEntities.MOD_ID, "textures/entity/" + name + "_eyes.png")));
	}

	@Override
	protected Identifier getTexture(T entity) {
		return this.skin;
	}

	@Override
	protected void scale(T entity, float tickDelta) {
		GlStateManager.scale(this.size, this.size, this.size);
	}

	/** Draws the eye overlay at full brightness regardless of the light level, like an enderman's eyes. */
	private static final class EyesFeature<T extends MobEntity> implements FeatureRenderer<T> {
		private final HorrorRenderer<T> renderer;
		private final Identifier texture;

		EyesFeature(HorrorRenderer<T> renderer, Identifier texture) {
			this.renderer = renderer;
			this.texture = texture;
		}

		@Override
		public void render(T entity, float limbSwing, float limbSwingAmount, float tickDelta, float age, float headYaw, float headPitch, float scale) {
			this.renderer.bindTexture(this.texture);
			GlStateManager.enableBlend();
			GlStateManager.disableAlphaTest();
			GlStateManager.blendFunc(1, 1);
			GlStateManager.disableLighting();
			GlStateManager.depthMask(!entity.isInvisible());
			GLX.gl13MultiTexCoord2f(GLX.lightmapTextureUnit, 61680.0F, 0.0F);
			GlStateManager.enableLighting();
			GlStateManager.color(1.0F, 1.0F, 1.0F, 1.0F);
			MinecraftClient.getInstance().gameRenderer.method_13847(true);
			this.renderer.getModel().render(entity, limbSwing, limbSwingAmount, age, headYaw, headPitch, scale);
			MinecraftClient.getInstance().gameRenderer.method_13847(false);
			this.renderer.method_14692(entity);
			GlStateManager.depthMask(true);
			GlStateManager.disableBlend();
			GlStateManager.enableAlphaTest();
		}

		@Override
		public boolean combineTextures() {
			return false;
		}
	}
}
