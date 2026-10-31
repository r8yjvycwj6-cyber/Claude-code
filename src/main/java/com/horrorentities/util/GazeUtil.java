package com.horrorentities.util;

import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.math.Vec3d;

/** Line-of-sight helpers: almost every horror entity cares about being looked at. */
public final class GazeUtil {
	/** cos of the half-angle of the "I am looking at it" cone (~50 degrees, roughly the screen). */
	public static final double DEFAULT_CONE = 0.64;

	private GazeUtil() {
	}

	/** True when {@code target} is inside the player's view cone and not behind a wall. */
	public static boolean isLookingAt(PlayerEntity player, Entity target, double cone) {
		Vec3d look = player.getRotationVector(1.0F).normalize();
		Vec3d toTarget = new Vec3d(
				target.x - player.x,
				target.y + target.getEyeHeight() - (player.y + player.getEyeHeight()),
				target.z - player.z);
		double dist = toTarget.length();

		if (dist < 0.001) {
			return true;
		}

		if (look.dotProduct(toTarget.multiply(1.0 / dist)) < cone) {
			return false;
		}

		return player.canSee(target);
	}

	public static boolean isLookingAt(PlayerEntity player, Entity target) {
		return isLookingAt(player, target, DEFAULT_CONE);
	}

	/** How directly the player faces the target: 1 = dead centre, below 0 = behind them. */
	public static double facing(PlayerEntity player, Entity target) {
		Vec3d look = player.getRotationVector(1.0F).normalize();
		Vec3d toTarget = new Vec3d(target.x - player.x, 0, target.z - player.z);

		if (toTarget.length() < 0.001) {
			return 1.0;
		}

		Vec3d flatLook = new Vec3d(look.x, 0, look.z);
		double len = flatLook.length();
		return len < 0.001 ? 1.0 : flatLook.multiply(1.0 / len).dotProduct(toTarget.normalize());
	}
}
