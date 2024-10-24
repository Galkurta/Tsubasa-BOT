const fs = require("fs");
const path = require("path");
const axios = require("axios");
const readline = require("readline");
const printBanner = require("./config/banner");
const logger = require("./config/logger");

// Constants untuk API endpoints dan konfigurasi
const API_CONFIG = {
  BASE_URL: "https://api.app.ton.tsubasa-rivals.com/api",
  ENDPOINTS: {
    START: "/start",
    TAP: "/tap",
    ENERGY_RECOVERY: "/energy/recovery",
    TAP_LEVELUP: "/tap/levelup",
    ENERGY_LEVELUP: "/energy/levelup",
    DAILY_REWARD: "/daily_reward/claim",
    CARD_LEVELUP: "/card/levelup",
    TASK_EXECUTE: "/task/execute",
    TASK_ACHIEVEMENT: "/task/achievement",
  },
};

// Constants untuk game settings
const GAME_CONSTANTS = {
  MAX_FAILED_ATTEMPTS: 3,
  RETRY_DELAY: 2000,
  CYCLE_DELAY: 1000,
  COOLDOWN_WAIT: 60000,
};

class TsubasaAPI {
  constructor() {
    this.headers = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US;q=0.6,en;q=0.5",
      "Content-Type": "application/json",
      Origin: "https://app.ton.tsubasa-rivals.com",
      Referer: "https://app.ton.tsubasa-rivals.com/",
      "Sec-Ch-Ua":
        '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    };
    this.config = null;
  }

  async promptConfig() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (query) =>
      new Promise((resolve) => rl.question(query, resolve));

    logger.info("Please configure the following settings:");

    this.config = {
      enableCardUpgrades:
        (await question("Enable card upgrades? (y/n): ")).toLowerCase() === "y",
      enableTapUpgrades:
        (await question("Enable tap upgrades? (y/n): ")).toLowerCase() === "y",
      enableEnergyUpgrades:
        (await question("Enable energy upgrades? (y/n): ")).toLowerCase() ===
        "y",
      maxUpgradeCost: parseInt(await question("Maximum upgrade cost: "), 10),
      maxTapUpgradeLevel: parseInt(
        await question("Maximum tap upgrade level: "),
        10
      ),
      maxEnergyUpgradeLevel: parseInt(
        await question("Maximum energy upgrade level: "),
        10
      ),
    };

    rl.close();
    logger.info("Configuration completed.");
  }

  async makeApiCall(endpoint, payload, context, axiosInstance) {
    try {
      const url = `${API_CONFIG.BASE_URL}${endpoint}`;

      // Update headers for each request
      if (payload.initData) {
        const userData = JSON.parse(
          decodeURIComponent(payload.initData.split("user=")[1].split("&")[0])
        );
        axiosInstance.defaults.headers["X-Player-Id"] = userData.id.toString();
      }

      const response = await axiosInstance.post(url, payload);

      if (response.status === 200) {
        return { success: true, data: response.data };
      }

      return {
        success: false,
        error: `Unexpected response | Status: ${response.status}`,
      };
    } catch (error) {
      return await this.handleApiError(error, context);
    }
  }

  async handleApiError(error, context) {
    if (error.response?.status === 400) {
      const errorMessage =
        error.response.data?.message || "No specific error message";
      logger.error(`Bad Request (400) | ${context} | ${errorMessage}`);

      if (errorMessage.includes("Wait for cooldown")) {
        logger.warn(`Cooldown period active for ${context}`);
        return { success: false, error: "cooldown", message: errorMessage };
      }

      if (errorMessage.includes("Insufficient funds")) {
        logger.warn(`Insufficient funds for ${context}`);
        return {
          success: false,
          error: "insufficient_funds",
          message: errorMessage,
        };
      }

      if (errorMessage.includes("Invalid initData")) {
        logger.error(`Invalid initData for ${context}`);
        return {
          success: false,
          error: "invalid_initdata",
          message: errorMessage,
        };
      }

      return { success: false, error: "Bad Request", message: errorMessage };
    }

    logger.error(`Error in ${context} | ${error.message}`);
    return { success: false, error: "unknown", message: error.message };
  }

  // API Method Implementations
  async callStartAPI(initData, axiosInstance) {
    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.START,
      { lang_code: "en", initData },
      "callStartAPI",
      axiosInstance
    );

    if (!result.success) {
      if (result.error === "cooldown") {
        logger.info("Waiting for 60 seconds before retrying...");
        await new Promise((resolve) =>
          setTimeout(resolve, GAME_CONSTANTS.COOLDOWN_WAIT)
        );
        return this.callStartAPI(initData, axiosInstance);
      }
      return result;
    }

    // Extract user data from response
    const { user = {} } = result.data.game_data || {};
    const {
      total_coins,
      energy,
      max_energy,
      multi_tap_count,
      profit_per_second,
    } = user;

    // Update master hash if present
    if (result.data.master_hash) {
      this.headers["X-Masterhash"] = result.data.master_hash;
      axiosInstance.defaults.headers["X-Masterhash"] = result.data.master_hash;
    }

    // Get available tasks
    const tasks = result.data.task_info
      ? result.data.task_info.filter(
          (task) => task.status === 0 || task.status === 1
        )
      : [];

    return {
      total_coins,
      energy,
      max_energy,
      multi_tap_count,
      profit_per_second,
      tasks,
      success: true,
    };
  }

  async callTapAPI(initData, tapCount, axiosInstance) {
    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.TAP,
      { tapCount, initData },
      "callTapAPI",
      axiosInstance
    );

    if (!result.success) return result;

    // Extract user data from response
    const { user = {} } = result.data.game_data || {};

    // Return relevant data
    return {
      ...user,
      success: true,
    };
  }

  async callEnergyRecoveryAPI(initData, axiosInstance) {
    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.ENERGY_RECOVERY,
      { initData },
      "callEnergyRecoveryAPI",
      axiosInstance
    );

    if (!result.success) return result;

    const { energy, max_energy } = result.data.game_data.user;
    return { energy, max_energy, success: true };
  }

  async callTapLevelUpAPI(initData, axiosInstance) {
    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.TAP_LEVELUP,
      { initData },
      "callTapLevelUpAPI",
      axiosInstance
    );

    if (!result.success) return result;

    const { tap_level, tap_level_up_cost, multi_tap_count, total_coins } =
      result.data.game_data.user;
    return {
      success: true,
      tap_level,
      tap_level_up_cost,
      multi_tap_count,
      total_coins,
    };
  }

  async callEnergyLevelUpAPI(initData, axiosInstance) {
    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.ENERGY_LEVELUP,
      { initData },
      "callEnergyLevelUpAPI",
      axiosInstance
    );

    if (!result.success) return result;

    const { energy_level, energy_level_up_cost, max_energy, total_coins } =
      result.data.game_data.user;
    return {
      success: true,
      energy_level,
      energy_level_up_cost,
      max_energy,
      total_coins,
    };
  }

  async upgradeGameStats(initData, axiosInstance) {
    const tapResult = await this.callTapAPI(initData, 1, axiosInstance);
    if (!tapResult.success) {
      logger.error(tapResult.error);
      return;
    }

    const requiredProps = [
      "total_coins",
      "energy",
      "max_energy",
      "multi_tap_count",
      "profit_per_second",
      "tap_level",
      "energy_level",
    ];

    const missingProps = requiredProps.filter(
      (prop) => tapResult[prop] === undefined
    );
    if (missingProps.length > 0) {
      logger.error(`Missing required properties | ${missingProps.join(", ")}`);
      return;
    }

    let { total_coins, tap_level, energy_level } = tapResult;

    // Upgrade Tap Level
    if (this.config.enableTapUpgrades) {
      const tapUpgradeResult = await this.upgradeTapLevel(
        initData,
        axiosInstance,
        tap_level,
        total_coins
      );

      if (tapUpgradeResult.success) {
        total_coins = tapUpgradeResult.total_coins;
      }
    }

    // Upgrade Energy Level
    if (this.config.enableEnergyUpgrades) {
      const energyUpgradeResult = await this.upgradeEnergyLevel(
        initData,
        axiosInstance,
        energy_level,
        total_coins
      );

      if (energyUpgradeResult.success) {
        total_coins = energyUpgradeResult.total_coins;
      }
    }

    return total_coins;
  }

  calculateTapLevelUpCost(currentLevel) {
    return 1000 * currentLevel;
  }

  calculateEnergyLevelUpCost(currentLevel) {
    return 1000 * currentLevel;
  }

  async upgradeTapLevel(
    initData,
    axiosInstance,
    currentTapLevel,
    availableCoins
  ) {
    let totalCoins = availableCoins;
    let tap_level = currentTapLevel;
    let tap_level_up_cost = this.calculateTapLevelUpCost(tap_level);

    while (
      tap_level < this.config.maxTapUpgradeLevel &&
      totalCoins >= tap_level_up_cost &&
      tap_level_up_cost <= this.config.maxUpgradeCost
    ) {
      const tapUpgradeResult = await this.callTapLevelUpAPI(
        initData,
        axiosInstance
      );

      if (!tapUpgradeResult.success) {
        logger.error(tapUpgradeResult.error || "Failed to upgrade tap level");
        break;
      }

      tap_level = tapUpgradeResult.tap_level;
      totalCoins = tapUpgradeResult.total_coins;
      tap_level_up_cost = this.calculateTapLevelUpCost(tap_level);

      logger.info(
        `Tap upgrade successful | Level: ${tap_level} | Cost: ${tap_level_up_cost} | Balance: ${totalCoins}`
      );
    }

    return { success: true, total_coins: totalCoins };
  }

  async upgradeEnergyLevel(
    initData,
    axiosInstance,
    currentEnergyLevel,
    availableCoins
  ) {
    let totalCoins = availableCoins;
    let energy_level = currentEnergyLevel;
    let energy_level_up_cost = this.calculateEnergyLevelUpCost(energy_level);

    while (
      energy_level < this.config.maxEnergyUpgradeLevel &&
      totalCoins >= energy_level_up_cost &&
      energy_level_up_cost <= this.config.maxUpgradeCost
    ) {
      const energyUpgradeResult = await this.callEnergyLevelUpAPI(
        initData,
        axiosInstance
      );

      if (!energyUpgradeResult.success) {
        logger.error(
          energyUpgradeResult.error || "Failed to upgrade energy level"
        );
        break;
      }

      energy_level = energyUpgradeResult.energy_level;
      totalCoins = energyUpgradeResult.total_coins;
      energy_level_up_cost = this.calculateEnergyLevelUpCost(energy_level);

      logger.info(
        `Energy upgrade successful | Level: ${energy_level} | Cost: ${energy_level_up_cost} | Balance: ${totalCoins}`
      );
    }

    return { success: true, total_coins: totalCoins };
  }

  // Task related methods
  async executeTask(initData, taskId, axiosInstance) {
    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.TASK_EXECUTE,
      { task_id: taskId, initData },
      `executeTask - ${taskId}`,
      axiosInstance
    );

    return result.success;
  }

  async checkTaskAchievement(initData, taskId, axiosInstance) {
    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.TASK_ACHIEVEMENT,
      { task_id: taskId, initData },
      `checkTaskAchievement - ${taskId}`,
      axiosInstance
    );

    if (result.success && result.data.task_info) {
      const updatedTask = result.data.task_info.find(
        (task) => task.id === taskId
      );
      if (updatedTask?.status === 2) {
        return {
          success: true,
          title: updatedTask.title,
          reward: updatedTask.reward,
        };
      }
    }

    return { success: false };
  }

  async processTasks(initData, axiosInstance, tasks) {
    if (!tasks || tasks.length === 0) {
      logger.warn("No tasks available.");
      return;
    }

    for (const task of tasks) {
      const executeResult = await this.executeTask(
        initData,
        task.id,
        axiosInstance
      );
      if (executeResult) {
        const achievementResult = await this.checkTaskAchievement(
          initData,
          task.id,
          axiosInstance
        );
        if (achievementResult.success) {
          logger.info(
            `Task | ${achievementResult.title} | Completed | ${achievementResult.reward}`
          );
        }
      }
    }
  }

  // Daily reward method
  async callDailyRewardAPI(initData, axiosInstance) {
    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.DAILY_REWARD,
      { initData },
      "callDailyRewardAPI",
      axiosInstance
    );

    if (result.success) {
      return { success: true, message: "Daily check-in successful" };
    }

    if (result.error === "cooldown") {
      return { success: false, message: "You have already checked in today" };
    }

    return { success: false, message: result.error || "Failed to check in" };
  }

  async processDaily(initData, axiosInstance) {
    const dailyRewardResult = await this.callDailyRewardAPI(
      initData,
      axiosInstance
    );
    logger.info(dailyRewardResult.message);
  }

  // Tap and recover methods
  async handleEnergyRecovery(initData, axiosInstance, maxEnergy) {
    // Tambahkan delay sebelum recovery untuk menghindari rate limit
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const recoveryResult = await this.callEnergyRecoveryAPI(
      initData,
      axiosInstance
    );

    if (!recoveryResult.success) {
      logger.warn(recoveryResult.error || "Energy recovery failed");
      return { success: false };
    }

    // Verifikasi hasil recovery
    if (recoveryResult.energy === maxEnergy) {
      logger.info(
        `Energy recovery successful | Current energy: ${recoveryResult.energy}/${maxEnergy}`
      );
      return { success: true, energy: recoveryResult.energy };
    } else {
      logger.warn(
        `Incomplete energy recovery | Current energy: ${recoveryResult.energy}/${maxEnergy}`
      );
      return { success: false };
    }
  }

  async verifyEnergyState(
    initData,
    axiosInstance,
    expectedEnergy,
    tolerance = 0
  ) {
    const verifyResult = await this.callStartAPI(initData, axiosInstance);
    if (!verifyResult.success) {
      return { success: false, error: "Failed to verify energy state" };
    }

    const actualEnergy = verifyResult.energy;
    const energyDiff = Math.abs(actualEnergy - expectedEnergy);

    if (energyDiff <= tolerance) {
      return { success: true, energy: actualEnergy };
    } else {
      return {
        success: false,
        error: `Energy mismatch | Expected: ${expectedEnergy} | Actual: ${actualEnergy}`,
        energy: actualEnergy,
      };
    }
  }

  async verifyEnergyStatus(
    initData,
    axiosInstance,
    currentEnergy,
    reportedEnergy
  ) {
    if (reportedEnergy >= currentEnergy) {
      logger.warn(
        "Energy not decreasing after tap. Verifying energy status..."
      );
      const verifyResult = await this.callStartAPI(initData, axiosInstance);

      if (verifyResult.success) {
        const actualEnergy = verifyResult.energy;
        if (actualEnergy >= reportedEnergy) {
          logger.error(
            "Energy verification failed. Possible synchronization issue."
          );
          return false;
        }
        return true;
      }
      return false;
    }
    return true;
  }

  async processTapCycle(
    initData,
    axiosInstance,
    currentEnergy,
    maxEnergy,
    multiTapCount
  ) {
    let failedAttempts = 0;
    let totalTapsThisCycle = 0;
    let continueProcess = true;

    while (currentEnergy > 0 && continueProcess) {
      const tapCount = Math.floor(currentEnergy / multiTapCount);
      if (tapCount === 0) break;

      const tapResult = await this.callTapAPI(
        initData,
        tapCount,
        axiosInstance
      );

      if (!tapResult.success) {
        failedAttempts++;
        logger.error(tapResult.error);

        if (failedAttempts >= GAME_CONSTANTS.MAX_FAILED_ATTEMPTS) {
          logger.error(
            `Maximum failed attempts (${GAME_CONSTANTS.MAX_FAILED_ATTEMPTS}) reached. Stopping tap process.`
          );
          continueProcess = false;
          break;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, GAME_CONSTANTS.RETRY_DELAY)
        );
        continue;
      }

      failedAttempts = 0;

      // Verify energy status
      const isEnergyValid = await this.verifyEnergyStatus(
        initData,
        axiosInstance,
        currentEnergy,
        tapResult.energy
      );

      if (!isEnergyValid) {
        continueProcess = false;
        break;
      }

      totalTapsThisCycle += tapCount;
      logger.info(
        `Tap successful | Taps: ${tapCount} | Remaining energy ${tapResult.energy}/${maxEnergy} | Balance: ${tapResult.total_coins}`
      );
      currentEnergy = tapResult.energy;

      // Handle low energy recovery
      if (currentEnergy <= multiTapCount) {
        const recoveryResult = await this.handleEnergyRecovery(
          initData,
          axiosInstance,
          maxEnergy
        );
        if (!recoveryResult.success) {
          continueProcess = false;
          break;
        }
        currentEnergy = recoveryResult.energy;
      }
    }

    return {
      totalTaps: totalTapsThisCycle,
      continueProcess,
      currentEnergy,
    };
  }

  async handleEnergyRecovery(initData, axiosInstance, maxEnergy) {
    const recoveryResult = await this.callEnergyRecoveryAPI(
      initData,
      axiosInstance
    );

    if (!recoveryResult.success) {
      logger.warn(recoveryResult.error);
      return { success: false };
    }

    if (recoveryResult.energy === maxEnergy) {
      logger.info(
        `Energy recovery successful | Current energy: ${recoveryResult.energy}/${maxEnergy}`
      );
      return { success: true, energy: recoveryResult.energy };
    } else {
      logger.warn(
        `Insufficient energy recovery | Current energy: ${recoveryResult.energy}/${maxEnergy}`
      );
      return { success: false };
    }
  }

  async tapAndRecover(initData, axiosInstance) {
    let totalTaps = 0;
    let failedAttempts = 0;
    const MAX_ATTEMPTS = 3;

    while (true) {
      try {
        // Get fresh energy status
        const startResult = await this.callStartAPI(initData, axiosInstance);
        if (!startResult.success) {
          logger.error("Failed to get energy status");
          break;
        }

        const currentEnergy = startResult.energy;
        const maxEnergy = startResult.max_energy;
        const multiTapCount = startResult.multi_tap_count;

        if (!multiTapCount) {
          logger.error("Multi tap count not available");
          break;
        }

        // If not enough energy for tap
        if (currentEnergy < multiTapCount) {
          logger.info(
            `Energy below required amount (${currentEnergy}/${multiTapCount}), attempting recovery...`
          );
          const recoveryResult = await this.callEnergyRecoveryAPI(
            initData,
            axiosInstance
          );
          if (recoveryResult.success) {
            logger.info(
              `Energy recovered to ${recoveryResult.energy}/${maxEnergy}`
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          } else {
            break;
          }
        }

        // Calculate maximum possible taps
        const possibleTaps = Math.floor(currentEnergy / multiTapCount);

        // Perform tap with all available energy
        const tapResult = await this.callTapAPI(
          initData,
          possibleTaps,
          axiosInstance
        );
        if (!tapResult.success) {
          failedAttempts++;
          logger.error(`Tap failed: ${tapResult.error}`);
          if (failedAttempts >= MAX_ATTEMPTS) {
            logger.error("Max tap attempts reached");
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }

        // Verify energy change
        const verifyResult = await this.callStartAPI(initData, axiosInstance);
        if (!verifyResult.success) {
          failedAttempts++;
          logger.warn("Failed to verify energy status");
          if (failedAttempts >= MAX_ATTEMPTS) break;
          continue;
        }

        // Calculate expected energy after tap
        const expectedEnergy = currentEnergy - possibleTaps * multiTapCount;
        const actualEnergy = verifyResult.energy;
        const energyTolerance = multiTapCount; // Allow some tolerance in energy calculation

        if (Math.abs(actualEnergy - expectedEnergy) > energyTolerance) {
          logger.warn(
            `Energy verification mismatch | ` +
              `Expected: ${expectedEnergy} | ` +
              `Actual: ${actualEnergy} | ` +
              `Difference: ${Math.abs(actualEnergy - expectedEnergy)}`
          );
          failedAttempts++;
          if (failedAttempts >= MAX_ATTEMPTS) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        // Tap successful
        totalTaps += possibleTaps;
        failedAttempts = 0;

        // Format numbers for better readability
        const formattedBalance = this.formatNumber(tapResult.total_coins);
        const formattedTaps = this.formatNumber(possibleTaps);

        logger.info(
          `Tap successful | ` +
            `Count: ${formattedTaps} | ` +
            `Energy: ${actualEnergy}/${maxEnergy} | ` +
            `Balance: ${formattedBalance}`
        );

        // If energy is low, try recovery
        if (actualEnergy < multiTapCount * 2) {
          const recoveryResult = await this.callEnergyRecoveryAPI(
            initData,
            axiosInstance
          );
          if (recoveryResult.success) {
            logger.info(
              `Energy recovered to ${recoveryResult.energy}/${maxEnergy}`
            );
          }
        }

        // Add small delay between cycles
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (error) {
        logger.error(`Tap process error: ${error.message}`);
        failedAttempts++;
        if (failedAttempts >= MAX_ATTEMPTS) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return totalTaps;
  }

  // Helper untuk format angka
  formatNumber(num) {
    return new Intl.NumberFormat().format(num);
  }

  // Card-related methods - tambahkan ke dalam class TsubasaAPI
  async getCardInfo(initData, axiosInstance) {
    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.START,
      { lang_code: "en", initData },
      "getCardInfo",
      axiosInstance
    );

    if (!result.success || !result.data.card_info) {
      logger.warn("Card information not found!");
      return null;
    }

    return result.data.card_info.flatMap((category) => {
      return category.card_list.map((card) => ({
        categoryId: card.category,
        cardId: card.id,
        level: card.level,
        cost: card.cost,
        unlocked: card.unlocked,
        name: card.name,
        profitPerHour: card.profit_per_hour,
        nextProfitPerHour: card.next_profit_per_hour,
        end_datetime: card.end_datetime,
      }));
    });
  }

  async levelUpCard(card, initData, axiosInstance) {
    const levelUpPayload = {
      category_id: card.categoryId,
      card_id: card.cardId,
      initData: initData,
    };

    const result = await this.makeApiCall(
      API_CONFIG.ENDPOINTS.CARD_LEVELUP,
      levelUpPayload,
      `levelUpCard - ${card.name}`,
      axiosInstance
    );

    return result;
  }

  async levelUpCards(initData, totalCoins, axiosInstance) {
    if (!this.config.enableCardUpgrades) {
      logger.info("Card upgrades are disabled in the config.");
      return totalCoins;
    }

    let updatedTotalCoins = totalCoins;
    let leveledUp = false;
    let cooldownCards = new Set();

    do {
      leveledUp = false;
      const cardInfo = await this.getCardInfo(initData, axiosInstance);

      if (!cardInfo) {
        logger.warn("Unable to get card information");
        break;
      }

      const sortedCards = this.sortCardsByProfitability(cardInfo);
      const result = await this.processCardUpgrades(
        sortedCards,
        updatedTotalCoins,
        initData,
        axiosInstance,
        cooldownCards
      );

      leveledUp = result.leveledUp;
      updatedTotalCoins = result.updatedTotalCoins;
    } while (leveledUp);

    return updatedTotalCoins;
  }

  sortCardsByProfitability(cards) {
    return cards.sort((a, b) => b.nextProfitPerHour - a.nextProfitPerHour);
  }

  async processCardUpgrades(
    sortedCards,
    totalCoins,
    initData,
    axiosInstance,
    cooldownCards
  ) {
    const currentTime = Math.floor(Date.now() / 1000);
    let leveledUp = false;
    let updatedTotalCoins = totalCoins;

    for (const card of sortedCards) {
      if (this.shouldSkipCard(card, currentTime, cooldownCards)) continue;

      if (this.canUpgradeCard(card, updatedTotalCoins)) {
        const upgradeResult = await this.attemptCardUpgrade(
          card,
          initData,
          axiosInstance,
          updatedTotalCoins,
          cooldownCards
        );

        if (upgradeResult.success) {
          updatedTotalCoins = upgradeResult.updatedTotalCoins;
          leveledUp = true;
          break;
        }
      }
    }

    return { leveledUp, updatedTotalCoins };
  }

  shouldSkipCard(card, currentTime, cooldownCards) {
    if (cooldownCards.has(card.cardId)) {
      return true;
    }

    if (card.end_datetime && currentTime > card.end_datetime) {
      logger.warn(
        `Card ${card.name} (${card.cardId}) has expired. Skipping upgrade.`
      );
      return true;
    }

    return false;
  }

  canUpgradeCard(card, totalCoins) {
    return (
      card.unlocked &&
      totalCoins >= card.cost &&
      card.cost <= this.config.maxUpgradeCost
    );
  }

  async attemptCardUpgrade(
    card,
    initData,
    axiosInstance,
    totalCoins,
    cooldownCards
  ) {
    try {
      const upgradeResult = await this.levelUpCard(
        card,
        initData,
        axiosInstance
      );

      if (upgradeResult.success) {
        const updatedTotalCoins = totalCoins - card.cost;
        logger.info(
          `Upgraded card | ${card.name} | ${card.cardId} | ${
            card.level + 1
          } | ${card.cost} | Remaining balance: ${updatedTotalCoins}`
        );
        return { success: true, updatedTotalCoins };
      }

      return { success: false };
    } catch (error) {
      return this.handleCardUpgradeError(error, card, cooldownCards);
    }
  }

  handleCardUpgradeError(error, card, cooldownCards) {
    if (error.response?.status === 400) {
      const errorMessage = error.response.data?.message;

      if (errorMessage?.includes("Wait for cooldown")) {
        logger.warn(
          `Cooldown for card ${card.name} (${card.cardId}). Skipping for now.`
        );
        cooldownCards.add(card.cardId);
      } else if (errorMessage?.includes("Insufficient funds")) {
        logger.warn(
          `Not enough coins to upgrade ${card.name} (${card.cardId}). Stopping upgrades.`
        );
      } else {
        logger.error(
          `Failed to upgrade card ${card.name} (${card.cardId}): ${errorMessage}`
        );
      }
    }

    return { success: false };
  }

  // Utility methods
  logAccountStatus(startResult) {
    if (startResult.total_coins !== undefined) {
      logger.info(`Balance: ${startResult.total_coins}`);
      logger.info(`Energy: ${startResult.energy}/${startResult.max_energy}`);
      logger.info(`Multi Tap Count: ${startResult.multi_tap_count}`);
      logger.info(`Profit per second: ${startResult.profit_per_second}`);
    }
  }

  async countdown(seconds) {
    for (let i = seconds; i >= 0; i--) {
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(`Wait ${i} seconds to continue the loop`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
  }

  // Main processing methods
  async processAccount(initData, axiosInstance) {
    const startResult = await this.callStartAPI(initData, axiosInstance);
    if (!startResult.success) {
      if (startResult.skipAccount) {
        logger.warn("Skipping account due to invalid initData");
        return;
      }
      logger.error(startResult.error);
      return;
    }

    this.logAccountStatus(startResult);

    await this.upgradeGameStats(initData, axiosInstance);
    await this.processTasks(initData, axiosInstance, startResult.tasks);

    const totalTaps = await this.tapAndRecover(initData, axiosInstance);
    logger.info(`Total taps: ${totalTaps}`);

    await this.processDaily(initData, axiosInstance);

    const updatedTotalCoins = await this.levelUpCards(
      initData,
      startResult.total_coins,
      axiosInstance
    );
    logger.info(`All eligible cards upgraded | Balance: ${updatedTotalCoins}`);
  }

  async main() {
    if (!this.config) {
      await this.promptConfig();
    }

    const dataFile = path.join(__dirname, "data.txt");
    const data = fs
      .readFileSync(dataFile, "utf8")
      .replace(/\r/g, "")
      .split("\n")
      .filter(Boolean);

    while (true) {
      for (let i = 0; i < data.length; i++) {
        const initData = data[i];
        const userData = JSON.parse(
          decodeURIComponent(initData.split("user=")[1].split("&")[0])
        );
        const firstName = userData.first_name;

        logger.info(`Account ${i + 1} | ${firstName}`);

        const axiosInstance = axios.create({ headers: this.headers });

        try {
          await this.processAccount(initData, axiosInstance);
        } catch (error) {
          logger.error(`Error processing account ${i + 1} | ${error.message}`);
        }

        await new Promise((resolve) =>
          setTimeout(resolve, GAME_CONSTANTS.CYCLE_DELAY)
        );
      }

      await this.countdown(60);
    }
  }
}

// Initialize and start the application
printBanner();
const client = new TsubasaAPI();
client.main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
