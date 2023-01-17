import { fork } from "child_process";

const restartEveryXMinutes = 10;

function restart() {
  let app = fork("index.js");
  app.on("close", () => {
    console.log(
      "\x1b[36m",
      "\nScript ended. Next start in " + restartEveryXMinutes + " minutes...\n",
      "\x1b[0m"
    );
    setTimeout(() => {
      restart();
    }, restartEveryXMinutes * 60 * 1000);
  });
}
restart();
