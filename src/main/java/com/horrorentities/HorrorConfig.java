package com.horrorentities;

import net.minecraftforge.common.ForgeConfigSpec;

/** Common config, written to config/horrorentities-common.toml. */
public final class HorrorConfig {
	public static final ForgeConfigSpec SPEC;

	public static final ForgeConfigSpec.BooleanValue ENABLE_DIRECTOR;
	public static final ForgeConfigSpec.DoubleValue DREAD_GAIN_MULTIPLIER;
	public static final ForgeConfigSpec.DoubleValue EVENT_FREQUENCY;
	public static final ForgeConfigSpec.BooleanValue ENABLE_FAKE_CHAT;
	public static final ForgeConfigSpec.BooleanValue ENABLE_AMBIENT_SOUNDS;
	public static final ForgeConfigSpec.BooleanValue ENABLE_TORCH_SNUFFING;
	public static final ForgeConfigSpec.BooleanValue ENABLE_TRACES;
	public static final ForgeConfigSpec.IntValue MAX_ENTITIES_PER_PLAYER;

	static {
		ForgeConfigSpec.Builder b = new ForgeConfigSpec.Builder();

		ENABLE_DIRECTOR = b.comment("Master switch for the dread director (ambient events and spawns).")
				.define("enableDirector", true);
		DREAD_GAIN_MULTIPLIER = b.comment("Multiplies how fast dread builds up. 0 disables dread gain.")
				.defineInRange("dreadGainMultiplier", 1.0, 0.0, 20.0);
		EVENT_FREQUENCY = b.comment("Multiplies how often events fire (higher = more frequent).")
				.defineInRange("eventFrequency", 1.0, 0.1, 20.0);
		ENABLE_FAKE_CHAT = b.comment("Fake join/leave messages and whispers in chat.")
				.define("enableFakeChat", true);
		ENABLE_AMBIENT_SOUNDS = b.comment("Footsteps, doors and other sounds behind the player.")
				.define("enableAmbientSounds", true);
		ENABLE_TORCH_SNUFFING = b.comment("Director events and the Shade may snuff out nearby torches (they drop as items).")
				.define("enableTorchSnuffing", true);
		ENABLE_TRACES = b.comment("The Hollow One may leave a netherrack block topped with a redstone torch behind.")
				.define("enableTraces", true);
		MAX_ENTITIES_PER_PLAYER = b.comment("Maximum horror entities alive near one player at once.")
				.defineInRange("maxEntitiesPerPlayer", 2, 0, 20);

		SPEC = b.build();
	}

	private HorrorConfig() {
	}
}
