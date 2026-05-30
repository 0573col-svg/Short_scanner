import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAlertKind1779938607575 implements MigrationInterface {
    name = 'AddAlertKind1779938607575'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "alerts" ADD "kind" text NOT NULL DEFAULT 'INSTANT'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "alerts" DROP COLUMN "kind"`);
    }

}
