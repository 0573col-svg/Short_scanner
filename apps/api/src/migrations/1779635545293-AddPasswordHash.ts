import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPasswordHash1779635545293 implements MigrationInterface {
    name = 'AddPasswordHash1779635545293'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "passwordHash" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "thresholds" SET DEFAULT '{"pumpPct":80,"topN":30,"minVolUsd":1000000}'`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "weights" SET DEFAULT '{"pump":15,"funding":20,"rsi":10,"divergence":20,"redCandles":25,"btcOk":5,"liquidity":5}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "weights" SET DEFAULT '{"rsi": 10, "pump": 15, "btcOk": 5, "funding": 20, "liquidity": 5, "divergence": 20, "redCandles": 25}'`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "thresholds" SET DEFAULT '{"topN": 30, "pumpPct": 80, "minVolUsd": 1000000}'`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "passwordHash"`);
    }

}
