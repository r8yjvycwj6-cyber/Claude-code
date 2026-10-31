package com.horrorentities.util;

import net.minecraft.core.Holder;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.protocol.game.ClientboundSoundPacket;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;

/** Server-side effects that only the affected player perceives. */
public final class HorrorFx {
	private HorrorFx() {
	}

	/** Plays a sound for one player only, as if it came from the given position. */
	public static void soundFor(Player player, Holder<SoundEvent> sound, double x, double y, double z, float volume, float pitch) {
		if (player instanceof ServerPlayer serverPlayer) {
			serverPlayer.connection.send(new ClientboundSoundPacket(sound, SoundSource.AMBIENT, x, y, z, volume, pitch,
					serverPlayer.getRandom().nextLong()));
		}
	}

	public static void soundFor(Player player, SoundEvent sound, double x, double y, double z, float volume, float pitch) {
		soundFor(player, Holder.direct(sound), x, y, z, volume, pitch);
	}

	/** Plays a sound for one player, centred on the player (used for stingers). */
	public static void soundFor(Player player, SoundEvent sound, float volume, float pitch) {
		soundFor(player, sound, player.getX(), player.getY(), player.getZ(), volume, pitch);
	}

	public static void soundFor(Player player, Holder<SoundEvent> sound, float volume, float pitch) {
		soundFor(player, sound, player.getX(), player.getY(), player.getZ(), volume, pitch);
	}

	/** A puff of dark smoke where the entity stood, then the entity is gone. */
	public static void vanish(Entity entity) {
		if (entity.level() instanceof ServerLevel level) {
			level.sendParticles(ParticleTypes.LARGE_SMOKE,
					entity.getX(), entity.getY() + entity.getBbHeight() * 0.5, entity.getZ(),
					18, entity.getBbWidth() * 0.4, entity.getBbHeight() * 0.4, entity.getBbWidth() * 0.4, 0.02);
		}

		entity.discard();
	}
}
