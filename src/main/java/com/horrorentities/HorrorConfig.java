package com.horrorentities;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

import net.fabricmc.loader.api.FabricLoader;

/** Tiny properties-file config, written with defaults on first launch. */
public final class HorrorConfig {
	/** Master switch for the whole dread director (ambient events + spawns). */
	public static boolean enableDirector = true;
	/** Multiplies how fast dread builds up. 0 disables dread gain. */
	public static double dreadGainMultiplier = 1.0;
	/** Multiplies how often events fire (higher = more frequent). */
	public static double eventFrequency = 1.0;
	public static boolean enableFakeChat = true;
	public static boolean enableAmbientSounds = true;
	public static boolean enableTorchSnuffing = true;
	/** Whether the Hollow One may leave small netherrack+torch shrines behind. */
	public static boolean enableTraces = true;
	/** Maximum horror entities alive near one player at once. */
	public static int maxEntitiesPerPlayer = 2;

	private HorrorConfig() {
	}

	public static void load() {
		Path file = FabricLoader.getInstance().getConfigDir().resolve("horrorentities.properties");
		Properties props = new Properties();

		if (Files.exists(file)) {
			try (InputStream in = Files.newInputStream(file)) {
				props.load(in);
			} catch (IOException e) {
				HorrorEntities.LOGGER.warn("Could not read {}: {}", file, e.toString());
			}
		}

		enableDirector = bool(props, "enableDirector", enableDirector);
		dreadGainMultiplier = number(props, "dreadGainMultiplier", dreadGainMultiplier);
		eventFrequency = number(props, "eventFrequency", eventFrequency);
		enableFakeChat = bool(props, "enableFakeChat", enableFakeChat);
		enableAmbientSounds = bool(props, "enableAmbientSounds", enableAmbientSounds);
		enableTorchSnuffing = bool(props, "enableTorchSnuffing", enableTorchSnuffing);
		enableTraces = bool(props, "enableTraces", enableTraces);
		maxEntitiesPerPlayer = (int) number(props, "maxEntitiesPerPlayer", maxEntitiesPerPlayer);

		try {
			Files.createDirectories(file.getParent());

			try (OutputStream out = Files.newOutputStream(file)) {
				props.store(out, "Horror Entities config");
			}
		} catch (IOException e) {
			HorrorEntities.LOGGER.warn("Could not write {}: {}", file, e.toString());
		}
	}

	private static boolean bool(Properties props, String key, boolean def) {
		String value = props.getProperty(key);
		boolean result = value == null ? def : Boolean.parseBoolean(value.trim());
		props.setProperty(key, Boolean.toString(result));
		return result;
	}

	private static double number(Properties props, String key, double def) {
		double result = def;
		String value = props.getProperty(key);

		if (value != null) {
			try {
				result = Double.parseDouble(value.trim());
			} catch (NumberFormatException ignored) {
				// fall back to the default
			}
		}

		props.setProperty(key, Double.toString(result));
		return result;
	}
}
