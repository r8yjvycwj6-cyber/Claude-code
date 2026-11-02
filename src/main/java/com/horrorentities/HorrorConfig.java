package com.horrorentities;

import net.minecraftforge.common.ForgeConfigSpec;

/** Common config, written to config/horrorentities-common.toml. */
public final class HorrorConfig {
	public static final ForgeConfigSpec SPEC;

	public static final ForgeConfigSpec.IntValue FIRST_NIGHT;
	public static final ForgeConfigSpec.DoubleValue SLEEP_BLOCK_RANGE;
	public static final ForgeConfigSpec.IntValue ATTACK_COOLDOWN_SECONDS;

	static {
		ForgeConfigSpec.Builder b = new ForgeConfigSpec.Builder();

		FIRST_NIGHT = b.comment("The night on which the Stalker first appears (1 = the very first night, 2 = the second night, ...).")
				.defineInRange("firstNight", 2, 1, 1000);
		SLEEP_BLOCK_RANGE = b.comment("Players cannot sleep while the Stalker is within this many blocks of them.")
				.defineInRange("sleepBlockRange", 32.0, 8.0, 128.0);
		ATTACK_COOLDOWN_SECONDS = b.comment("Seconds the Stalker waits between strikes. It lurks around you in the meantime.")
				.defineInRange("attackCooldownSeconds", 90, 10, 3600);

		SPEC = b.build();
	}

	private HorrorConfig() {
	}
}
