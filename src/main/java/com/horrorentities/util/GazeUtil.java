package com.horrorentities.util;

import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

/** Line-of-sight helpers: almost every horror entity cares about being looked at. */
public final class GazeUtil {
	/** cos of the half-angle of the "I am looking at it" cone (~50 degrees, roughly the screen). */
	public static final double DEFAULT_CONE = 0.64;

	private GazeUtil() {
	}

	/** True when {@code target} is inside the player's view cone and not behind a wall. */
	public static boolean isLookingAt(Player player, Entity target, double cone) {
		Vec3 look = player.getViewVector(1.0F).normalize();
		Vec3 toTarget = new Vec3(
				target.getX() - player.getX(),
				target.getEyeY() - player.getEyeY(),
				target.getZ() - player.getZ());
		double dist = toTarget.length();

		if (dist < 0.001) {
			return true;
		}

		if (look.dot(toTarget.scale(1.0 / dist)) < cone) {
			return false;
		}

		return player.hasLineOfSight(target);
	}

	public static boolean isLookingAt(Player player, Entity target) {
		return isLookingAt(player, target, DEFAULT_CONE);
	}
}
