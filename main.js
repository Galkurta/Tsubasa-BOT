const fs = require("fs");
const path = require("path");
const axios = require("axios");
const readline = require("readline");
const printBanner = require("./config/banner");
const logger = require("./config/logger");

class Tsubasa {
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

    console.log("Please configure the following settings:");

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

  async handleApiError(error, context) {
    if (error.response && error.response.status === 400) {
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

      return { success: false, error: "Bad Requests", message: errorMessage };
    }

    logger.error(`Error in ${context} | ${error.message}`);
    return { success: false, error: "unknown", message: error.message };
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

  async callStartAPI(initData, axiosInstance) {
    const startUrl = "https://app.ton.tsubasa-rivals.com/api/start";
    const startPayload = { lang_code: "en", initData: initData };

    try {
      const startResponse = await axiosInstance.post(startUrl, startPayload);
      if (
        startResponse.status === 200 &&
        startResponse.data &&
        startResponse.data.game_data
      ) {
        const {
          total_coins,
          energy,
          max_energy,
          coins_per_tap,
          profit_per_second,
        } = startResponse.data.game_data.user || {};
        const masterHash = startResponse.data.master_hash;
        if (masterHash) {
          this.headers["X-Masterhash"] = masterHash;
        }

        const tasks = startResponse.data.task_info
          ? startResponse.data.task_info.filter(
              (task) => task.status === 0 || task.status === 1
            )
          : [];

        return {
          total_coins,
          energy,
          max_energy,
          coins_per_tap,
          profit_per_second,
          tasks,
          success: true,
        };
      } else {
        return {
          success: false,
          error: `Unexpected response | Status: ${startResponse.status}`,
        };
      }
    } catch (error) {
      const errorResult = await this.handleApiError(error, "callStartAPI");
      if (errorResult.error === "cooldown") {
        logger.info("Waiting for 60 seconds before retrying...");
        await new Promise((resolve) => setTimeout(resolve, 60000));
        return this.callStartAPI(initData, axiosInstance);
      }
      if (errorResult.error === "invalid_initdata") {
        logger.error("Invalid initData. Skipping this account.");
        return { success: false, error: "invalid_initdata", skipAccount: true };
      }
      return errorResult;
    }
  }

  async callDailyRewardAPI(initData, axiosInstance) {
    const dailyRewardUrl =
      "https://app.ton.tsubasa-rivals.com/api/daily_reward/claim";
    const dailyRewardPayload = { initData: initData };

    try {
      const dailyRewardResponse = await axiosInstance.post(
        dailyRewardUrl,
        dailyRewardPayload
      );
      if (dailyRewardResponse.status === 200) {
        return { success: true, message: "Daily check-in successful" };
      } else {
        return { success: false, message: "You have already checked in today" };
      }
    } catch (error) {
      const errorResult = await this.handleApiError(
        error,
        "callDailyRewardAPI"
      );
      if (errorResult.error === "cooldown") {
        return { success: false, message: "You have already checked in today" };
      }
      return errorResult;
    }
  }

  async executeTask(initData, taskId, axiosInstance) {
    const executeUrl = "https://app.ton.tsubasa-rivals.com/api/task/execute";
    const executePayload = { task_id: taskId, initData: initData };

    try {
      const executeResponse = await axiosInstance.post(
        executeUrl,
        executePayload
      );
      return executeResponse.status === 200;
    } catch (error) {
      const errorResult = await this.handleApiError(
        error,
        `executeTask - ${taskId}`
      );
      logger.error(
        `Error when doing task | ${taskId} | ${errorResult.message}`
      );
      return false;
    }
  }

  async checkTaskAchievement(initData, taskId, axiosInstance) {
    const achievementUrl =
      "https://app.ton.tsubasa-rivals.com/api/task/achievement";
    const achievementPayload = { task_id: taskId, initData: initData };

    try {
      const achievementResponse = await axiosInstance.post(
        achievementUrl,
        achievementPayload
      );
      if (achievementResponse.status === 200) {
        if (
          achievementResponse.data &&
          achievementResponse.data &&
          achievementResponse.data.task_info
        ) {
          const updatedTask = achievementResponse.data.task_info.find(
            (task) => task.id === taskId
          );
          if (updatedTask && updatedTask.status === 2) {
            return {
              success: true,
              title: updatedTask.title,
              reward: updatedTask.reward,
            };
          }
        }
      }
      return { success: false };
    } catch (error) {
      const errorResult = await this.handleApiError(
        error,
        `checkTaskAchievement - ${taskId}`
      );
      logger.error(`Error | ${taskId} | ${errorResult.message}`);
      return { success: false };
    }
  }

  async getCardInfo(initData, axiosInstance) {
    const startUrl = "https://app.ton.tsubasa-rivals.com/api/start";
    const startPayload = { lang_code: "en", initData: initData };

    try {
      const startResponse = await axiosInstance.post(startUrl, startPayload);
      if (
        startResponse.status === 200 &&
        startResponse.data &&
        startResponse.data.card_info
      ) {
        const cardInfo = startResponse.data.card_info.flatMap((category) => {
          return category.card_list.map((card) => ({
            categoryId: card.category,
            cardId: card.id,
            level: card.level,
            cost: card.cost,
            unlocked: card.unlocked,
            name: card.name,
            profitPerHour: card.profit_per_hour,
            nextProfitPerHour: card.next_profit_per_hour,
          }));
        });
        return cardInfo;
      } else {
        logger.warn("Card information not found!");
        return null;
      }
    } catch (error) {
      const errorResult = await this.handleApiError(error, "getCardInfo");
      logger.error(`Error getting card information | ${errorResult.message}`);
      return null;
    }
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

      const sortedCards = cardInfo.sort(
        (a, b) => b.nextProfitPerHour - a.nextProfitPerHour
      );

      for (const card of sortedCards) {
        if (cooldownCards.has(card.cardId)) {
          continue;
        }

        if (
          card.unlocked &&
          updatedTotalCoins >= card.cost &&
          card.cost <= this.config.maxUpgradeCost
        ) {
          const levelUpUrl =
            "https://app.ton.tsubasa-rivals.com/api/card/levelup";
          const levelUpPayload = {
            category_id: card.categoryId,
            card_id: card.cardId,
            initData: initData,
          };

          try {
            const levelUpResponse = await axiosInstance.post(
              levelUpUrl,
              levelUpPayload
            );
            if (levelUpResponse.status === 200) {
              updatedTotalCoins -= card.cost;
              leveledUp = true;
              logger.info(
                `Upgraded card | ${card.name} | ${card.cardId} | ${
                  card.level + 1
                } | ${card.cost} | Remaining balance: ${updatedTotalCoins}`
              );
              break;
            }
          } catch (error) {
            const errorResult = await this.handleApiError(
              error,
              `levelUpCards - ${card.name}`
            );
            if (errorResult.error === "cooldown") {
              logger.warn(
                `Cooldown for card ${card.name} (${card.cardId}). Skipping for now.`
              );
              cooldownCards.add(card.cardId);
            } else if (errorResult.error === "insufficient_funds") {
              logger.warn(
                `Not enough coins to upgrade ${card.name} (${card.cardId}). Stopping upgrades.`
              );
              return updatedTotalCoins;
            } else {
              logger.error(
                `Failed to upgrade card ${card.name} (${card.cardId}): ${errorResult.message}`
              );
            }
          }
        }
      }
    } while (leveledUp);

    return updatedTotalCoins;
  }

  async callTapAPI(initData, tapCount, axiosInstance) {
    const tapUrl = "https://app.ton.tsubasa-rivals.com/api/tap";
    const tapPayload = { tapCount: tapCount, initData: initData };

    try {
      const tapResponse = await axiosInstance.post(tapUrl, tapPayload);
      if (tapResponse.status === 200) {
        const {
          total_coins,
          energy,
          max_energy,
          coins_per_tap,
          profit_per_second,
          energy_level,
          tap_level,
        } = tapResponse.data.game_data.user;
        return {
          total_coins,
          energy,
          max_energy,
          coins_per_tap,
          profit_per_second,
          energy_level,
          tap_level,
          success: true,
        };
      } else {
        return {
          success: false,
          error: `Tap error | Status: ${tapResponse.status}`,
        };
      }
    } catch (error) {
      const errorResult = await this.handleApiError(error, "callTapAPI");
      return {
        success: false,
        error: errorResult.error,
        message: errorResult.message,
      };
    }
  }

  async callEnergyRecoveryAPI(initData, axiosInstance) {
    const recoveryUrl =
      "https://app.ton.tsubasa-rivals.com/api/energy/recovery";
    const recoveryPayload = { initData: initData };

    try {
      const recoveryResponse = await axiosInstance.post(
        recoveryUrl,
        recoveryPayload
      );
      if (recoveryResponse.status === 200) {
        const { energy, max_energy } = recoveryResponse.data.game_data.user;
        return { energy, max_energy, success: true };
      } else {
        return { success: false, error: `Unable to recover energy yet` };
      }
    } catch (error) {
      const errorResult = await this.handleApiError(
        error,
        "callEnergyRecoveryAPI"
      );
      return {
        success: false,
        error: errorResult.error,
        message: errorResult.message,
      };
    }
  }

  async tapAndRecover(initData, axiosInstance) {
    let continueProcess = true;
    let totalTaps = 0;

    while (continueProcess) {
      const startResult = await this.callStartAPI(initData, axiosInstance);
      if (!startResult.success) {
        logger.error(startResult.error);
        break;
      }

      let currentEnergy = startResult.energy;
      const maxEnergy = startResult.max_energy;

      while (currentEnergy > 0) {
        const tapResult = await this.callTapAPI(
          initData,
          currentEnergy,
          axiosInstance
        );
        if (!tapResult.success) {
          logger.error(tapResult.error);
          continueProcess = false;
          break;
        }

        totalTaps += currentEnergy;
        logger.info(
          `Tap successful | Remaining energy ${tapResult.energy}/${tapResult.max_energy} | Balance: ${tapResult.total_coins}`
        );
        currentEnergy = 0;

        const recoveryResult = await this.callEnergyRecoveryAPI(
          initData,
          axiosInstance
        );
        if (!recoveryResult.success) {
          logger.warn(recoveryResult.error);
          continueProcess = false;
          break;
        }

        if (recoveryResult.energy === maxEnergy) {
          currentEnergy = recoveryResult.energy;
          logger.info(
            `Energy recovery successful | Current energy: ${currentEnergy}/${maxEnergy}`
          );
        } else {
          logger.warn(
            `Insufficient energy recovery | Current energy: ${recoveryResult.energy}/${maxEnergy}`
          );
          continueProcess = false;
          break;
        }
      }
    }

    return totalTaps;
  }

  async callTapLevelUpAPI(initData, axiosInstance) {
    const tapLevelUpUrl = "https://app.ton.tsubasa-rivals.com/api/tap/levelup";
    const payload = { initData: initData };

    try {
      const response = await axiosInstance.post(tapLevelUpUrl, payload);
      if (response.status === 200) {
        const { tap_level, tap_level_up_cost, coins_per_tap, total_coins } =
          response.data.game_data.user;
        return {
          success: true,
          tap_level,
          tap_level_up_cost,
          coins_per_tap,
          total_coins,
        };
      } else {
        return {
          success: false,
          error: `Error upgrading tap | Status: ${response.status}`,
        };
      }
    } catch (error) {
      const errorResult = await this.handleApiError(error, "callTapLevelUpAPI");
      return {
        success: false,
        error: errorResult.error,
        message: errorResult.message,
      };
    }
  }

  async callEnergyLevelUpAPI(initData, axiosInstance) {
    const energyLevelUpUrl =
      "https://app.ton.tsubasa-rivals.com/api/energy/levelup";
    const payload = { initData: initData };

    try {
      const response = await axiosInstance.post(energyLevelUpUrl, payload);
      if (response.status === 200) {
        const { energy_level, energy_level_up_cost, max_energy, total_coins } =
          response.data.game_data.user;
        return {
          success: true,
          energy_level,
          energy_level_up_cost,
          max_energy,
          total_coins,
        };
      } else {
        return {
          success: false,
          error: `Error upgrading energy | Status: ${response.status}`,
        };
      }
    } catch (error) {
      const errorResult = await this.handleApiError(
        error,
        "callEnergyLevelUpAPI"
      );
      return {
        success: false,
        error: errorResult.error,
        message: errorResult.message,
      };
    }
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
      "coins_per_tap",
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

    let {
      total_coins,
      energy,
      max_energy,
      coins_per_tap,
      profit_per_second,
      tap_level,
      energy_level,
    } = tapResult;

    let tap_level_up_cost = this.calculateTapLevelUpCost(tap_level);
    let energy_level_up_cost = this.calculateEnergyLevelUpCost(energy_level);

    if (this.config.enableTapUpgrades) {
      while (
        tap_level < this.config.maxTapUpgradeLevel &&
        total_coins >= tap_level_up_cost &&
        tap_level_up_cost <= this.config.maxUpgradeCost
      ) {
        const tapUpgradeResult = await this.callTapLevelUpAPI(
          initData,
          axiosInstance
        );
        if (tapUpgradeResult.success) {
          tap_level = tapUpgradeResult.tap_level;
          total_coins = tapUpgradeResult.total_coins;
          coins_per_tap = tapUpgradeResult.coins_per_tap;
          tap_level_up_cost = this.calculateTapLevelUpCost(tap_level);
          logger.info(
            `Tap upgrade successful | ${tap_level} | ${tap_level_up_cost} | Balance: ${total_coins}`
          );
        } else {
          logger.error(tapUpgradeResult.error);
          break;
        }
      }
    }

    if (this.config.enableEnergyUpgrades) {
      while (
        energy_level < this.config.maxEnergyUpgradeLevel &&
        total_coins >= energy_level_up_cost &&
        energy_level_up_cost <= this.config.maxUpgradeCost
      ) {
        const energyUpgradeResult = await this.callEnergyLevelUpAPI(
          initData,
          axiosInstance
        );
        if (energyUpgradeResult.success) {
          energy_level = energyUpgradeResult.energy_level;
          total_coins = energyUpgradeResult.total_coins;
          max_energy = energyUpgradeResult.max_energy;
          energy_level_up_cost = this.calculateEnergyLevelUpCost(energy_level);
          logger.info(
            `Energy upgrade successful | ${energy_level} | ${energy_level_up_cost} | Balance: ${total_coins}`
          );
        } else {
          logger.error(energyUpgradeResult.error);
          break;
        }
      }
    }
  }

  calculateTapLevelUpCost(currentLevel) {
    return 1000 * currentLevel;
  }

  calculateEnergyLevelUpCost(currentLevel) {
    return 1000 * currentLevel;
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
        const firstName = JSON.parse(
          decodeURIComponent(initData.split("user=")[1].split("&")[0])
        ).first_name;

        logger.info(`Account ${i + 1} | ${firstName}`);

        const axiosInstance = axios.create({
          headers: this.headers,
        });

        try {
          const startResult = await this.callStartAPI(initData, axiosInstance);
          if (startResult.success) {
            if (startResult.total_coins !== undefined) {
              logger.info(`Balance: ${startResult.total_coins}`);
              logger.info(
                `Energy: ${startResult.energy}/${startResult.max_energy}`
              );
              logger.info(`Coins per tap: ${startResult.coins_per_tap}`);
              logger.info(
                `Profit per second: ${startResult.profit_per_second}`
              );
            }

            await this.upgradeGameStats(initData, axiosInstance);

            if (startResult.tasks && startResult.tasks.length > 0) {
              for (const task of startResult.tasks) {
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
            } else {
              logger.warn(`No tasks available.`);
            }

            const totalTaps = await this.tapAndRecover(initData, axiosInstance);
            logger.info(`Total taps: ${totalTaps}`);

            const dailyRewardResult = await this.callDailyRewardAPI(
              initData,
              axiosInstance
            );
            logger.info(
              dailyRewardResult.message,
              dailyRewardResult.success ? "success" : "warning"
            );

            const updatedTotalCoins = await this.levelUpCards(
              initData,
              startResult.total_coins,
              axiosInstance
            );
            logger.info(
              `All eligible cards upgraded | Balance: ${updatedTotalCoins}`
            );
          } else if (startResult.skipAccount) {
            logger.warn(`Skipping account ${i + 1} due to invalid initData`);
            continue;
          } else {
            logger.error(startResult.error);
          }
        } catch (error) {
          logger.error(`Error processing account ${i + 1} | ${error.message}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await this.countdown(60);
    }
  }
}

printBanner();
const client = new Tsubasa();
client.main().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
