package com.horrorentities.client;

import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeDeformation;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.world.entity.Mob;

/**
 * The vanilla humanoid skeleton with arm and leg proportions we can change, on a 64x64 skin.
 * Thin, over-long limbs are what make most of these things look wrong.
 */
public class HorrorModel<T extends Mob> extends HumanoidModel<T> {
	public HorrorModel(ModelPart root) {
		super(root);
	}

	/**
	 * @param limbWidth width/depth of arms and legs in texels (vanilla is 4)
	 * @param armLength arm length in texels (vanilla is 12)
	 * @param legLength leg length in texels (vanilla is 12)
	 */
	public static LayerDefinition createBodyLayer(int limbWidth, int armLength, int legLength) {
		MeshDefinition mesh = HumanoidModel.createMesh(CubeDeformation.NONE, 0.0F);
		PartDefinition root = mesh.getRoot();

		float depth = -limbWidth / 2.0F;
		float rightArmX = -limbWidth + 1.0F;

		root.addOrReplaceChild("right_arm", CubeListBuilder.create().texOffs(40, 16)
				.addBox(rightArmX, -2.0F, depth, limbWidth, armLength, limbWidth), PartPose.offset(-5.0F, 2.0F, 0.0F));
		root.addOrReplaceChild("left_arm", CubeListBuilder.create().texOffs(40, 16).mirror()
				.addBox(-1.0F, -2.0F, depth, limbWidth, armLength, limbWidth), PartPose.offset(5.0F, 2.0F, 0.0F));
		root.addOrReplaceChild("right_leg", CubeListBuilder.create().texOffs(0, 16)
				.addBox(depth, 0.0F, depth, limbWidth, legLength, limbWidth), PartPose.offset(-1.9F, 12.0F, 0.0F));
		root.addOrReplaceChild("left_leg", CubeListBuilder.create().texOffs(0, 16).mirror()
				.addBox(depth, 0.0F, depth, limbWidth, legLength, limbWidth), PartPose.offset(1.9F, 12.0F, 0.0F));

		return LayerDefinition.create(mesh, 64, 64);
	}
}
