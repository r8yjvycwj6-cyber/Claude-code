package com.horrorentities.client.render;

import net.minecraft.client.render.entity.model.BiPedModel;
import net.minecraft.client.render.model.ModelPart;

/**
 * The vanilla biped skeleton with arm and leg proportions we can change, on a 64x64 skin.
 * Thin, over-long limbs are what make most of these things look wrong.
 */
public class HorrorModel extends BiPedModel {
	/**
	 * @param limbWidth  width/depth of arms and legs in texels (vanilla is 4)
	 * @param armLength  arm length in texels (vanilla is 12)
	 * @param legLength  leg length in texels (vanilla is 12)
	 */
	public HorrorModel(int limbWidth, int armLength, int legLength) {
		super(0.0F, 0.0F, 64, 64);
		int half = limbWidth / 2;

		this.rightArm = new ModelPart(this, 40, 16);
		this.rightArm.addCuboid(-half, -2.0F, -half, limbWidth, armLength, limbWidth);
		this.rightArm.setPivot(-5.0F, 2.0F, 0.0F);

		this.leftArm = new ModelPart(this, 40, 16);
		this.leftArm.mirror = true;
		this.leftArm.addCuboid(-half, -2.0F, -half, limbWidth, armLength, limbWidth);
		this.leftArm.setPivot(5.0F, 2.0F, 0.0F);

		this.rightLeg = new ModelPart(this, 0, 16);
		this.rightLeg.addCuboid(-half, 0.0F, -half, limbWidth, legLength, limbWidth);
		this.rightLeg.setPivot(-1.9F, 12.0F, 0.0F);

		this.leftLeg = new ModelPart(this, 0, 16);
		this.leftLeg.mirror = true;
		this.leftLeg.addCuboid(-half, 0.0F, -half, limbWidth, legLength, limbWidth);
		this.leftLeg.setPivot(1.9F, 12.0F, 0.0F);
	}

	public static HorrorModel standard() {
		return new HorrorModel(4, 12, 12);
	}
}
