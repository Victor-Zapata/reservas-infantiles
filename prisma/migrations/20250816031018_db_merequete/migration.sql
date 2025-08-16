-- CreateEnum
CREATE TYPE "public"."ReservationStatus" AS ENUM ('draft', 'pending_payment', 'confirmed', 'completed', 'canceled');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "public"."PaymentKind" AS ENUM ('deposit', 'remainder', 'full', 'other');

-- CreateTable
CREATE TABLE "public"."Guardian" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "docNumber" TEXT,

    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Child" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guardianId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dni" TEXT,
    "ageYears" INTEGER NOT NULL,
    "conditions" TEXT,
    "hasConditions" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Reservation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guardianId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "totalHours" INTEGER NOT NULL DEFAULT 0,
    "hourlyRate" INTEGER NOT NULL,
    "depositPct" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "depositAmount" INTEGER NOT NULL,
    "remainingAmount" INTEGER NOT NULL,
    "status" "public"."ReservationStatus" NOT NULL DEFAULT 'draft',
    "externalRef" TEXT,
    "mpPreferenceId" TEXT,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReservationChild" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,

    CONSTRAINT "ReservationChild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Payment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL DEFAULT 'mercadopago',
    "providerId" TEXT,
    "reservationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" "public"."PaymentKind" NOT NULL,
    "status" "public"."PaymentStatus" NOT NULL,
    "raw" JSONB,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentEvent" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SlotStock" (
    "date" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SlotStock_pkey" PRIMARY KEY ("date","hour")
);

-- CreateTable
CREATE TABLE "public"."AppConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "hourlyRate" INTEGER NOT NULL DEFAULT 14000,
    "depositPct" INTEGER NOT NULL DEFAULT 50,
    "maxPerHour" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Guardian_email_key" ON "public"."Guardian"("email");

-- CreateIndex
CREATE INDEX "Reservation_date_hour_idx" ON "public"."Reservation"("date", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationChild_reservationId_childId_key" ON "public"."ReservationChild"("reservationId", "childId");

-- AddForeignKey
ALTER TABLE "public"."Child" ADD CONSTRAINT "Child_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "public"."Guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Reservation" ADD CONSTRAINT "Reservation_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "public"."Guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReservationChild" ADD CONSTRAINT "ReservationChild_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "public"."Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReservationChild" ADD CONSTRAINT "ReservationChild_childId_fkey" FOREIGN KEY ("childId") REFERENCES "public"."Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "public"."Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
