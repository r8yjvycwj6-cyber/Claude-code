package com.horrorentities.util;

import net.minecraft.client.particle.ParticleType;
import net.minecraft.client.sound.SoundCategory;
import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.ServerPlayerEntity;
import net.minecraft.network.packet.s2c.play.PlaySoundIdS2CPacket;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.Sound;

/** Server-side effects that only the affected player perceives. */
public final class HorrorFx {
	private HorrorFx() {
	}

	/** Plays a sound for one player only, as if it came from the given position. */
	public static void soundFor(PlayerEntity player, Sound sound, double x, double y, double z, float volume, float pitch) {
		if (player instanceof ServerPlayerEntity) {
			((ServerPlayerEntity) player).networkHandler.sendPacket(
					new PlaySoundIdS2CPacket(sound, SoundCategory.AMBIENT, x, y, z, volume, pitch));
		}
	}

	/** Plays a sound for one player, centred on the player (used for stingers). */
	public static void soundFor(PlayerEntity player, Sound sound, float volume, float pitch) {
		soundFor(player, sound, player.x, player.y, player.z, volume, pitch);
	}

	/** A puff of dark smoke where the entity stood, then the entity is gone. */
	public static void vanish(Entity entity) {
		if (entity.world instanceof ServerWorld) {
			((ServerWorld) entity.world).addParticle(ParticleType.SMOKE_LARGE,
					entity.x, entity.y + entity.height * 0.5, entity.z,
					18, entity.width * 0.4, entity.height * 0.4, entity.width * 0.4, 0.02);
		}

		entity.remove();
	}
}
