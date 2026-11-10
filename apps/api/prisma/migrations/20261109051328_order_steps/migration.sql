-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PACKED';
ALTER TYPE "OrderStatus" ADD VALUE 'SHIPPED';
ALTER TYPE "OrderStatus" ADD VALUE 'DELIVERED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RefundReason" ADD VALUE 'CANCELLED_BY_CUSTOMER';
ALTER TYPE "RefundReason" ADD VALUE 'CANCELLED_BY_STAFF';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "courierName" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "packedAt" TIMESTAMP(3),
ADD COLUMN     "shippedAt" TIMESTAMP(3),
ADD COLUMN     "trackingNumber" TEXT;

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");
